import { base64ToBytes, bytesToBase64 } from '@rexezuge/shared';

/**
 * Base64 for the byte payloads the bridge carries.
 *
 * The Diffie-Hellman values are 256-byte numbers and the signalling packets
 * are opaque, so they travel as text. The engine has the other half of this
 * pair in `packages/backend-services/src/session/base64.ts`, and both use the
 * family's codec so the two cannot drift.
 */

/**
 * Decodes a base64 string into bytes, or returns `null` when it is not
 * base64 at all.
 */
export function fromBase64(value: string): Uint8Array | null {
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
export function toBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}
