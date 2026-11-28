import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { base64UrlToBytes, bytesToBase64Url, concatBytes, pushText } from '../../packages/backend-services/src/session/push-encoding';
import { encryptPushPayload, loadVapidKeys, vapidAuthorization } from '../../packages/backend-services/src/session/push-crypto';
import type { StoredPushSubscription } from '../../packages/backend-services/src/session/push-subscriptions';

/**
The two halves of Web Push the engine owns, checked against Node's own
crypto: a VAPID signature the WebCrypto verifier accepts, and an RFC 8291
record Node can decrypt with keys derived independently. Workerd supplies
the same WebCrypto primitives at runtime.
*/
function vapidPair() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string; y: string };
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return { pkcs8: pkcs8.toString('base64url'), jwk };
}

function userAgentKey() {
  const ecdh = createECDH('prime256v1');
  const publicKey = ecdh.generateKeys();
  return { ecdh, publicKey };
}

function subscription(publicKey: Buffer, auth: Buffer): StoredPushSubscription {
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/device-token',
    p256dh: publicKey.toString('base64url'),
    auth: auth.toString('base64url'),
    createdAt: 0,
    lastUsedAt: 0,
    failures: 0,
  };
}

/**
Decrypts an `aes128gcm` body with Node crypto, independently of the engine.
*/
function decrypt(body: Uint8Array, ecdh: ReturnType<typeof createECDH>, auth: Buffer, vapidPublic: Uint8Array): string {
  const salt = Buffer.from(body.slice(0, 16));
  const recordSize = Buffer.from(body.slice(16, 20)).readUInt32BE(0);
  expect(recordSize).toBe(4096);
  const keyIdLength = body[20] as number;
  const ephemeral = Buffer.from(body.slice(21, 21 + keyIdLength));
  const ciphertext = Buffer.from(body.slice(21 + keyIdLength));

  const shared = ecdh.computeSecret(ephemeral);
  const info = concatBytes(pushText('WebPush: info\0'), ecdh.getPublicKey(), vapidPublic);
  const inputKey = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const contentKey = Buffer.from(hkdfSync('sha256', inputKey, salt, pushText('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', inputKey, salt, pushText('Content-Encoding: nonce\0'), 12));

  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce, { authTagLength: 16 });
  decipher.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  const delimiter = padded.indexOf(2);
  expect(delimiter).toBeGreaterThanOrEqual(0);
  expect(padded.subarray(delimiter + 1).every((byte) => byte === 0)).toBe(true);
  return padded.subarray(0, delimiter).toString('utf8');
}

describe('Web Push cryptography', () => {
  it('base64url round-trips binary keys', () => {
    const bytes = new Uint8Array(randomBytes(65));
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    expect(base64UrlToBytes('not*base64')).toBeNull();
    expect(base64UrlToBytes('A=')).toBeNull();
  });

  it('signs a VAPID JWT with the deployment key', async () => {
    const pair = vapidPair();
    const keys = await loadVapidKeys(pair.pkcs8);
    expect(bytesToBase64Url(keys.publicKey)).toBe(
      bytesToBase64Url(concatBytes(new Uint8Array([4]), Buffer.from(pair.jwk.x, 'base64url'), Buffer.from(pair.jwk.y, 'base64url'))),
    );

    const authorization = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/device-token',
      keys,
      'mailto:test@example.com',
      () => 1_700_000_000_000,
    );
    const token = /^vapid t=(.+), k=(.+)$/.exec(authorization);
    expect(token).not.toBeNull();
    expect(token?.[2]).toBe(bytesToBase64Url(keys.publicKey));
    const [header, claims, signature] = (token?.[1] as string).split('.', 3);
    expect(JSON.parse(Buffer.from(header as string, 'base64url').toString())).toEqual({ alg: 'ES256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims as string, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_700_000_000 + 12 * 60 * 60,
      sub: 'mailto:test@example.com',
    });
    const verifier = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: pair.jwk.x, y: pair.jwk.y },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    await expect(
      crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        verifier,
        Buffer.from(signature as string, 'base64url'),
        pushText(`${header}.${claims}`) as BufferSource,
      ),
    ).resolves.toBe(true);
  });

  it('refuses a key whose public point cannot be recovered', async () => {
    const pair = vapidPair();
    const importKey = crypto.subtle.importKey.bind(crypto.subtle);
    const noCoordinates = {
      importKey,
      exportKey: vi.fn(async () => ({})),
    } as unknown as SubtleCrypto;
    await expect(loadVapidKeys(pair.pkcs8, noCoordinates)).rejects.toThrow('not P-256');
    const badCoordinates = {
      importKey,
      exportKey: vi.fn(async () => ({ kty: 'EC', crv: 'P-256', x: '!!!!', y: '!!!!' })),
    } as unknown as SubtleCrypto;
    await expect(loadVapidKeys(pair.pkcs8, badCoordinates)).rejects.toThrow('malformed');
  });

  it('refuses malformed key material and an oversized payload', async () => {
    const { ecdh, publicKey } = userAgentKey();
    const auth = randomBytes(16);
    const pair = vapidPair();
    const keys = await loadVapidKeys(pair.pkcs8);
    await expect(loadVapidKeys('not*base64')).rejects.toThrow('not base64url');
    await expect(encryptPushPayload('{}', { ...subscription(publicKey, auth), p256dh: 'not*base64' }, keys.publicKey)).rejects.toThrow(
      'malformed',
    );
    await expect(encryptPushPayload('x'.repeat(4096), subscription(publicKey, auth), keys.publicKey)).rejects.toThrow('too large');
    expect(ecdh.getPublicKey().length).toBe(65);
  });

  it('encrypts an RFC 8291 record Node can decrypt', async () => {
    const { ecdh, publicKey } = userAgentKey();
    const auth = randomBytes(16);
    const pair = vapidPair();
    const keys = await loadVapidKeys(pair.pkcs8);
    const payload = JSON.stringify({ chatId: -100_123, title: 'Ada', body: 'Hello there' });

    const encrypted = await encryptPushPayload(payload, subscription(publicKey, auth), keys.publicKey);

    expect(encrypted.length).toBe(16 + 4 + 1 + 65 + 4096);
    expect(new DataView(encrypted.buffer, encrypted.byteOffset).getUint32(16)).toBe(4096);
    expect(decrypt(encrypted, ecdh, auth, keys.publicKey)).toBe(payload);
  });
});
