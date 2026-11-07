import { base64ToBytes, bytesToBase64 } from '@rexezuge/shared';

/**
 * Base64 for the byte payloads a call carries.
 *
 * The bridge is JSON, so the Diffie-Hellman values and the signalling
 * packets have to travel as text. The engine already decodes callback data
 * this way; this module is the shared pair, so the encoding and the decoding
 * cannot drift apart.
 *
 * The codec is the family's: a direct 3-byte-to-4-char table on the encode
 * side and `atob` on the decode side, with no allocation of a binary string
 * for the whole payload. The local guard stays because this module's contract
 * is `null` for malformed input — a caller turns that into a 400 with its own
 * wording — while `base64ToBytes` throws by design.
 */

/**
 * Decodes a base64 string into bytes.
 *
 * Returns `null` when the string is not base64 at all.
 */
export function decodeBase64(value: string): Uint8Array | null {
  if (value.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(value)) return null;
  try {
    return base64ToBytes(value);
  } catch {
    return null;
  }
}

/**
 * Encodes bytes as base64.
 */
export function encodeBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}
