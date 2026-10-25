/**
 * Base64 for the byte payloads the bridge carries.
 *
 * The Diffie-Hellman values are 256-byte numbers and the signalling packets
 * are opaque, so they travel as text. The engine has the other half of this
 * pair in `packages/backend-services/src/session/base64.ts`.
 */

/**
 * Decodes a base64 string into bytes, or returns `null` when it is not
 * base64 at all.
 */
export function fromBase64(value: string): Uint8Array | null {
  if (value.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(value)) return null;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Encodes bytes as base64.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x80_00;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
