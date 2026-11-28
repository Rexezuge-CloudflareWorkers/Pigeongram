/**
The VAPID public key the browser subscribed with.

It is a build-time `VITE_*` variable: public by design, safe to inline in
the bundle, and paired with the worker's private key secret. An absent or
malformed key disables the notification toggle rather than presenting a
switch that cannot work.
*/

/**
A raw uncompressed P-256 point: `0x04 | X (32) | Y (32)`.
*/
const PUBLIC_KEY_BYTES = 65;

export function vapidPublicKey(): Uint8Array<ArrayBuffer> | null {
  const value = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (bytes.length !== PUBLIC_KEY_BYTES || bytes[0] !== 4) return null;
    return bytes;
  } catch {
    return null;
  }
}
