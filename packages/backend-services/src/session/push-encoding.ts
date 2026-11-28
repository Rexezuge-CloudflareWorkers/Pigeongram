/**
The URL-safe base64 the Web Push specs use.

VAPID keys, the subscription's `p256dh`/`auth` and the encrypted payload all
cross JSON as base64url. `atob`/`btoa` are available in workerd and in the
test runtime, so no codec dependency is needed; this module is the one
place the alphabet is translated.
*/

const encoder = new TextEncoder();

/**
Encodes bytes as unpadded base64url.
*/
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
Decodes unpadded (or padded) base64url. Returns `null` for malformed input.
*/
export function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[\w-]*={0,2}$/i.test(value) || value.length % 4 === 1) return null;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/**
UTF-8 bytes, for the JWT signing input and the payload record.
*/
export function pushText(value: string): Uint8Array {
  return encoder.encode(value);
}

/**
Concatenates the byte strings HKDF's `info` and the record header need.
*/
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
