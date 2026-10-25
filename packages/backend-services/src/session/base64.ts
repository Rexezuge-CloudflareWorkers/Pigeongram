/**
 * Base64 for the byte payloads a call carries.
 *
 * The bridge is JSON, so the Diffie-Hellman values and the signalling
 * packets have to travel as text. The engine already decodes callback data
 * this way; this module is the shared pair, so the encoding and the decoding
 * cannot drift apart.
 */

/**
 * Decodes a base64 string into bytes.
 *
 * Returns `null` when the string is not base64 at all — the caller turns that
 * into a 400 with its own wording.
 */
export function decodeBase64(value: string): Uint8Array | null {
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
 *
 * The chunked build keeps a long payload off the argument list: spreading a
 * few hundred bytes is fine, but a signalling packet can be larger and the
 * engine's memory is the Free plan's 128 MB.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x80_00;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
