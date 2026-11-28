/**
The two cryptographic pieces Web Push needs, both on WebCrypto.

**VAPID** is the application-server authentication: a short-lived ES256 JWT
signed with the deployment's private P-256 key, sent to the push service in
the `Authorization` header. The browser subscribed with the matching public
key, so the push service can tell which application is sending.

**Payload encryption** is RFC 8291: an ephemeral ECDH key, an HKDF chain
bound to the subscription's auth secret and the VAPID public key, and one
AES-128-GCM record. The browser decrypts it before the service worker sees
it, so the worker only handles a plain JSON payload.

No npm push library is involved: `web-push` is Node-only, and workerd's
`crypto.subtle` has every primitive used here.
*/

import type { StoredPushSubscription } from './push-subscriptions';
import { base64UrlToBytes, bytesToBase64Url, concatBytes, pushText } from './push-encoding';

const VAPID_LIFETIME_SECONDS = 12 * 60 * 60;
const RECORD_SIZE = 4096;
const TAG_BYTES = 16;
const DELIMITER = 2;
const SALT_BYTES = 16;

export interface VapidKeys {
  /**
  The ES256 signing key, imported once per Durable Object.
  */
  readonly privateKey: CryptoKey;
  /**
  The raw uncompressed P-256 point the browser subscribed with.
  */
  readonly publicKey: Uint8Array;
}

/**
Imports the base64url PKCS#8 private key and recovers its public point from
the JWK export. Only one key is ever needed, so both are derived once.
*/
export async function loadVapidKeys(privateKeyBase64Url: string, subtle: SubtleCrypto = crypto.subtle): Promise<VapidKeys> {
  const pkcs8 = base64UrlToBytes(privateKeyBase64Url);
  if (!pkcs8) throw new Error('VAPID private key is not base64url');
  const privateKey = await subtle.importKey('pkcs8', pkcs8 as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await subtle.exportKey('jwk', privateKey);
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new TypeError('VAPID private key is not P-256');
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);
  if (!x || !y || x.length !== 32 || y.length !== 32) throw new Error('VAPID public key is malformed');
  return { privateKey, publicKey: concatBytes(new Uint8Array([4]), x, y) };
}

/**
Builds the `Authorization: vapid …` value for one push endpoint.
*/
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now: () => number = Date.now,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = bytesToBase64Url(pushText(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const claims = bytesToBase64Url(
    pushText(JSON.stringify({ aud: audience, exp: Math.floor(now() / 1000) + VAPID_LIFETIME_SECONDS, sub: subject })),
  );
  const signingInput = `${header}.${claims}`;
  const signature = new Uint8Array(
    await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, pushText(signingInput) as BufferSource),
  );
  return `vapid t=${signingInput}.${bytesToBase64Url(signature)}, k=${bytesToBase64Url(keys.publicKey)}`;
}

/**
Encrypts one JSON payload for a subscription, per RFC 8291 §3.4.

The body is `salt (16) | record size (4, big endian) | key id length (1) |
ephemeral public key (65) | AES-GCM record`. A delimiter and zero padding
fill the record to `RECORD_SIZE`; the browser strips them after decrypting.
*/
export async function encryptPushPayload(
  payload: string,
  subscription: StoredPushSubscription,
  vapidPublicKey: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<Uint8Array> {
  const uaPublicKey = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);
  if (!uaPublicKey || !authSecret) throw new Error('Push subscription keys are malformed');

  const ephemeral = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephemeralPublicKey = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublicKey as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256));

  const info = concatBytes(pushText('WebPush: info\0'), uaPublicKey, vapidPublicKey);
  const inputKey = await hkdf(sharedSecret, authSecret, info, 32, subtle);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const contentKey = await hkdf(inputKey, salt, pushText('Content-Encoding: aes128gcm\0'), 16, subtle);
  const nonce = await hkdf(inputKey, salt, pushText('Content-Encoding: nonce\0'), 12, subtle);

  // `rs` counts the ciphertext record only; the key id lives in the body
  // header. The record is exactly `RECORD_SIZE` bytes, including its tag, so
  // the plaintext has room for the message, the delimiter and zero padding.
  const room = RECORD_SIZE - TAG_BYTES;
  const message = pushText(payload);
  if (message.length >= room) throw new Error('Push payload is too large');
  const plaintext = new Uint8Array(room);
  plaintext.set(message);
  plaintext[message.length] = DELIMITER;

  const aesKey = await subtle.importKey('raw', contentKey as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, plaintext));

  const body = new Uint8Array(SALT_BYTES + 4 + 1 + ephemeralPublicKey.length + ciphertext.length);
  body.set(salt);
  new DataView(body.buffer).setUint32(SALT_BYTES, RECORD_SIZE, false);
  body[SALT_BYTES + 4] = ephemeralPublicKey.length;
  body.set(ephemeralPublicKey, SALT_BYTES + 5);
  body.set(ciphertext, SALT_BYTES + 5 + ephemeralPublicKey.length);
  return body;
}

async function hkdf(inputKey: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number, subtle: SubtleCrypto): Promise<Uint8Array> {
  const base = await subtle.importKey('raw', inputKey as BufferSource, 'HKDF', false, ['deriveBits']);
  const derived = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    base,
    length * 8,
  );
  return new Uint8Array(derived);
}
