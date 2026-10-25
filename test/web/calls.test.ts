import { describe, expect, it, vi } from 'vitest';
import { fromBase64, toBase64 } from '../../apps/web/src/calls/base64';
import { CallCipher } from '../../apps/web/src/calls/crypto';
import {
  bigIntToBytes,
  bytesToBigInt,
  checkPeerValue,
  createDhKeyPair,
  deriveSharedKey,
  keyFingerprint,
  modPow,
  validateDhConfig,
} from '../../apps/web/src/calls/dh';
import { establishKey } from '../../apps/web/src/calls/exchange';
import { decodeSignal, encodeSignal } from '../../apps/web/src/calls/signalling';
import { callReducer } from '../../apps/web/src/calls/session';
import type { CallView } from '../../apps/web/src/calls/session';
import { iceServersFor } from '../../apps/web/src/calls/webrtc';

/**
 * The calls of the SPA.
 *
 * Three things are worth testing here: the state machine the overlay renders,
 * the arithmetic of the key exchange, and the packet envelope — the last one
 * because a mistake in it is invisible until two peers fail to talk.
 */

/**
 * A deterministic key, so a failure is reproducible.
 */
function key(seed: number): Uint8Array {
  const bytes = new Uint8Array(256);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (seed + index) & 0xff;
  }
  return bytes;
}

describe('the call state machine', () => {
  const outgoing: CallView = {
    callId: '1',
    chatId: 7,
    peerId: 7,
    direction: 'outgoing',
    phase: 'ringing',
    muted: false,
    fingerprint: null,
    error: null,
    startedAt: 0,
  };

  it('starts an outgoing call in the ringing phase', () => {
    const view = callReducer(null, { type: 'outgoing', callId: '1', chatId: 7, peerId: 7 });
    expect(view).toMatchObject({ direction: 'outgoing', phase: 'ringing', chatId: 7 });
  });

  it('starts an incoming call in the ringing phase', () => {
    const view = callReducer(null, { type: 'incoming', callId: '1', chatId: 7, peerId: 7 });
    expect(view).toMatchObject({ direction: 'incoming', phase: 'ringing' });
  });

  it('ignores what happens to another call', () => {
    expect(callReducer(outgoing, { type: 'phase', callId: '2', phase: 'active' })).toBe(outgoing);
    expect(callReducer(outgoing, { type: 'muted', callId: '2', muted: true })).toBe(outgoing);
    expect(callReducer(outgoing, { type: 'fingerprint', callId: '2', fingerprint: '1' })).toBe(outgoing);
  });

  it('moves through the phases', () => {
    const connecting = callReducer(outgoing, { type: 'phase', callId: '1', phase: 'connecting' });
    expect(connecting?.phase).toBe('connecting');
    const active = callReducer(connecting, { type: 'phase', callId: '1', phase: 'active' });
    expect(active?.phase).toBe('active');
    const ended = callReducer(active, { type: 'ended', callId: '1' });
    expect(ended?.phase).toBe('ended');
  });

  it('keeps the fingerprint and the mute with the call', () => {
    const withFingerprint = callReducer(outgoing, { type: 'fingerprint', callId: '1', fingerprint: '-42' });
    expect(withFingerprint?.fingerprint).toBe('-42');
    const muted = callReducer(withFingerprint, { type: 'muted', callId: '1', muted: true });
    expect(muted?.muted).toBe(true);
    expect(muted?.fingerprint).toBe('-42');
  });

  it('ends a failed call with its reason', () => {
    const failed = callReducer(outgoing, { type: 'failed', callId: '1', error: 'The key did not match' });
    expect(failed?.phase).toBe('ended');
    expect(failed?.error).toBe('The key did not match');
  });

  it('takes the overlay away', () => {
    expect(callReducer(outgoing, { type: 'dismissed' })).toBeNull();
  });
});

describe('the modular exponentiation', () => {
  it('agrees with the small cases', () => {
    expect(modPow(2n, 10n, 1000n)).toBe(24n);
    expect(modPow(3n, 0n, 7n)).toBe(1n);
    expect(modPow(5n, 1n, 7n)).toBe(5n);
  });

  it('survives a round trip through bytes', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0xff]);
    expect(bigIntToBytes(bytesToBigInt(bytes), 4)).toEqual(bytes);
  });

  it('refuses a value that does not fit', () => {
    expect(() => bigIntToBytes(256n, 1)).toThrow();
  });
});

describe('the key exchange', () => {
  it('derives the same key on both sides', async () => {
    const config = await validateDhConfig({ g: 2, p: safePrime() });
    const caller = await createDhKeyPair(config);
    const callee = await createDhKeyPair(config);

    const callerKey = await deriveSharedKey(config, caller.secret, callee.value);
    const calleeKey = await deriveSharedKey(config, callee.secret, caller.value);

    expect(Array.from(callerKey)).toEqual(Array.from(calleeKey));
    expect(callerKey).toHaveLength(256);
  });

  it('gives the commitment of the public value', async () => {
    const config = await validateDhConfig({ g: 2, p: safePrime() });
    const caller = await createDhKeyPair(config);
    const hash = await crypto.subtle.digest('SHA-256', caller.value as BufferSource);
    expect(Array.from(new Uint8Array(hash))).toEqual(Array.from(caller.hash));
  });

  it('refuses a peer value that is out of range', async () => {
    const config = await validateDhConfig({ g: 2, p: safePrime() });
    const caller = await createDhKeyPair(config);
    await expect(deriveSharedKey(config, caller.secret, new Uint8Array(256))).rejects.toThrow();
  });

  it('reads the fingerprint as a decimal 64-bit number', async () => {
    const fingerprint = await keyFingerprint(key(1));
    expect(fingerprint).toMatch(/^-?\d{1,20}$/);
  });
});

/**
 * A 2048-bit safe prime, with the generator Telegram's own configuration uses.
 *
 * It is the prime of RFC 3526's 2048-bit group, which is a safe prime with
 * 2 as its generator — the same shape Telegram's `messages.getDhConfig` hands
 * out, and enough to run a real exchange in a test.
 */
function safePrime(): Uint8Array {
  const hex =
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
    '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
    'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
    'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
    '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
    'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
    '15728E5A8AACAA68FFFFFFFFFFFFFFFF';
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

describe('the packet envelope', () => {
  it('reads back what it wrote', async () => {
    const shared = key(1);
    const caller = new CallCipher(shared, true);
    const callee = new CallCipher(shared, false);
    const payload = new TextEncoder().encode('the session description');

    const packet = await caller.encrypt('signaling', payload);

    const plain = await callee.decrypt('signaling', packet);
    expect(plain).not.toBeNull();
    expect(Array.from(plain!)).toEqual(Array.from(payload));
  });

  it('reads back what the callee wrote', async () => {
    const shared = key(1);
    const caller = new CallCipher(shared, true);
    const callee = new CallCipher(shared, false);
    const payload = new TextEncoder().encode('the answer');

    const packet = await callee.encrypt('signaling', payload);

    const plain = await caller.decrypt('signaling', packet);
    expect(plain).not.toBeNull();
    expect(Array.from(plain!)).toEqual(Array.from(payload));
  });

  it('keeps the two channels apart', async () => {
    const shared = key(2);
    const caller = new CallCipher(shared, true);
    const callee = new CallCipher(shared, false);
    const payload = new TextEncoder().encode('hello');

    const packet = await caller.encrypt('signaling', payload);

    // The transport channel has its own keys, so the packet does not open.
    expect(await callee.decrypt('transport', packet)).toBeNull();
  });

  it('refuses a packet whose body was changed', async () => {
    const shared = key(3);
    const caller = new CallCipher(shared, true);
    const callee = new CallCipher(shared, false);
    const packet = await caller.encrypt('signaling', new Uint8Array([1, 2, 3]));

    const tampered = packet.slice();
    tampered[tampered.length - 1] ^= 0xff;

    expect(await callee.decrypt('signaling', tampered)).toBeNull();
  });

  it('refuses a packet of another key', async () => {
    const caller = new CallCipher(key(4), true);
    const callee = new CallCipher(key(5), false);
    const packet = await caller.encrypt('signaling', new Uint8Array([1, 2, 3]));

    expect(await callee.decrypt('signaling', packet)).toBeNull();
  });

  it('refuses the same packet twice', async () => {
    const shared = key(6);
    const caller = new CallCipher(shared, true);
    const callee = new CallCipher(shared, false);
    const packet = await caller.encrypt('signaling', new Uint8Array([1, 2, 3]));

    expect(await callee.decrypt('signaling', packet)).not.toBeNull();
    expect(await callee.decrypt('signaling', packet)).toBeNull();
  });

  it('refuses a packet that is too short', async () => {
    const callee = new CallCipher(key(7), false);
    expect(await callee.decrypt('signaling', new Uint8Array(8))).toBeNull();
  });

  it('refuses a key that is not 256 bytes wide', () => {
    expect(() => new CallCipher(new Uint8Array(128), true)).toThrow();
  });
});

describe('the signalling payloads', () => {
  it('reads back what it wrote', () => {
    const message = { kind: 'offer' as const, sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' };
    expect(decodeSignal(encodeSignal(message))).toEqual(message);
  });

  it('reads back a candidate', () => {
    const message = { kind: 'candidate' as const, mid: '0', index: 0, candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host' };
    expect(decodeSignal(encodeSignal(message))).toEqual(message);
  });

  it('refuses a packet it does not know', () => {
    expect(decodeSignal(new Uint8Array([9, 1, 2]))).toBeNull();
    expect(decodeSignal(new Uint8Array([1]))).toBeNull();
  });
});

describe('the base64 of the bridge', () => {
  it('reads back what it wrote', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('refuses a string that is not base64', () => {
    expect(fromBase64('not base64!')).toBeNull();
  });
});

describe('the relays of a call', () => {
  it('serves the WebRTC endpoints and leaves the legacy ones alone', () => {
    const servers = iceServersFor([
      {
        id: '1',
        ip: '203.0.113.7',
        ipv6: '',
        port: 3478,
        turn: true,
        stun: true,
        username: 'user',
        password: 'secret',
        tcp: false,
        peerTag: '',
      },
      {
        id: '2',
        ip: '198.51.100.9',
        ipv6: '',
        port: 443,
        turn: false,
        stun: false,
        username: '',
        password: '',
        tcp: true,
        peerTag: 'AAAA',
      },
    ]);

    expect(servers).toHaveLength(2);
    expect(servers[0].urls).toBe('turn:203.0.113.7:3478?transport=udp');
    expect(servers[0].username).toBe('user');
    expect(servers[1].urls).toBe('stun:203.0.113.7:3478');
  });
});

describe('the key exchange guards', () => {
  it('refuses a negative integer and a non-positive modulus', () => {
    expect(() => bigIntToBytes(-1n, 4)).toThrow('negative');
    expect(() => modPow(2n, 3n, 0n)).toThrow('positive');
    expect(modPow(-2n, 3n, 5n)).toBe(2n);
  });

  it('refuses a prime that is the wrong width or not prime', async () => {
    await expect(validateDhConfig({ g: 2, p: new Uint8Array(8) })).rejects.toThrow('2048 bits');
    await expect(validateDhConfig({ g: 2, p: new Uint8Array(256) })).rejects.toThrow('not prime');
  });

  it('refuses a generator outside the field and one that is not a residue', async () => {
    const p = safePrime();
    await expect(validateDhConfig({ g: 1, p })).rejects.toThrow('out of range');
    await expect(validateDhConfig({ g: 11, p })).rejects.toThrow('quadratic residue');
  });

  it('refuses a peer value in another subgroup', async () => {
    const config = await validateDhConfig({ g: 2, p: safePrime() });
    expect(() => checkPeerValue(config, bigIntToBytes(11n, 256))).toThrow('wrong subgroup');
    expect(() => checkPeerValue(config, bigIntToBytes(1n, 256))).toThrow('out of range');
  });

  it('does not let the private exponent fall to one', async () => {
    const zeros = new Uint8Array(256);
    const getRandomValues = vi.spyOn(crypto, 'getRandomValues').mockReturnValue(zeros as never);
    const config = await validateDhConfig({ g: 2, p: safePrime() });

    const pair = await createDhKeyPair(config);

    expect(pair.secret).toBe(2n);
    getRandomValues.mockRestore();
  });

  it('checks the commitment and the fingerprint against the derived key', async () => {
    const config = await validateDhConfig({ g: 2, p: safePrime() });
    const caller = await createDhKeyPair(config);
    const callee = await createDhKeyPair(config);
    const expected = await establishKey({ config, secret: caller.secret, peerValue: callee.value });
    const hint = expected.fingerprint;

    await expect(establishKey({ config, secret: caller.secret, peerValue: callee.value, commitment: new Uint8Array(32) })).rejects.toThrow(
      'commitment',
    );
    await expect(establishKey({ config, secret: caller.secret, peerValue: callee.value, expectedFingerprint: '0' })).rejects.toThrow(
      'fingerprint',
    );
    await expect(
      establishKey({ config, secret: caller.secret, peerValue: callee.value, expectedFingerprint: hint }),
    ).resolves.toMatchObject({ fingerprint: hint });
  });

  it('compares commitment bytes of different lengths as different', async () => {
    const config = await validateDhConfig({ g: 2, p: safePrime() });
    const caller = await createDhKeyPair(config);
    const callee = await createDhKeyPair(config);

    await expect(establishKey({ config, secret: caller.secret, peerValue: callee.value, commitment: new Uint8Array(1) })).rejects.toThrow(
      'commitment',
    );
  });
});
