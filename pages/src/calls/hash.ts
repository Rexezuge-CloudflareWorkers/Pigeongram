/**
 * The hashes the call's cryptography is built on.
 *
 * WebCrypto's digest is the only hashing the browser offers, and it is
 * asynchronous — which is fine, because every use here is off the render
 * path. The call's key exchange runs in the page on purpose: the shared key
 * must never be near the worker, and a Diffie-Hellman modexp of 2048 bits is
 * far beyond the Free plan's 10 ms of CPU per invocation.
 */

/**
 * Concatenates byte arrays.
 */
export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * A slice of a byte array.
 *
 * `subarray` shares the buffer, which is what the key schedule wants: the
 * pieces of the shared key are views into it, not copies of it.
 */
export function slice(bytes: Uint8Array, start: number, length?: number): Uint8Array {
  return bytes.subarray(start, start + (length ?? bytes.length - start));
}

/**
 * SHA-256 over bytes.
 */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/**
 * SHA-1 over bytes.
 *
 * The shared key's fingerprint is defined as the lower 64 bits of SHA1 over
 * the key, and SHA-1 is here for that fingerprint alone — never for anything
 * that protects a secret.
 */
export async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
  // eslint-disable-next-line sonarjs/hashing -- Telegram defines the fingerprint with SHA-1; it protects nothing.
  return new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as BufferSource));
}

/**
 * Compares two byte arrays in constant time.
 *
 * The key schedule compares a received `msg_key` against the one it
 * recomputes, and a timing difference there would leak the key.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (const [index, element] of a.entries()) {
    difference |= element ^ b[index];
  }
  return difference === 0;
}
