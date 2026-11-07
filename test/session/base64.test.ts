import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from '../../packages/backend-services/src/session/base64';

/**
 * The engine's half of the bridge's base64 pair.
 *
 * The decoder's contract is `null` on malformed input — every caller turns that
 * into its own 400 — so the guard has to survive the move onto the family
 * codec, which throws by design.
 */

describe('decodeBase64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 250, 255]);

    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });

  it('decodes the empty string to empty bytes', () => {
    expect(decodeBase64('')).toEqual(new Uint8Array());
  });

  it('returns null for a string that is not base64', () => {
    for (const value of ['not base64!', 'abc', 'a===', '====', 'AAAAA']) {
      expect(decodeBase64(value), value).toBeNull();
    }
  });
});

describe('encodeBase64', () => {
  it('uses the standard alphabet with padding', () => {
    expect(encodeBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=');
  });

  it('encodes a payload larger than the old spread chunk', () => {
    const bytes = new Uint8Array(300_000).fill(0xab);
    const encoded = encodeBase64(bytes);

    expect(encoded).toHaveLength(400_000);
    expect(decodeBase64(encoded)).toEqual(bytes);
  });
});
