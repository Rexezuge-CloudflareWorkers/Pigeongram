/**
Validation of the one body a browser sends to subscribe to push.

The bridge's other parsers are shared between the edge and the engine
because they read streams. This body is a small JSON object, so the engine
validates it once and the edge only forwards it. The rules matter for two
reasons: a malformed key would fail inside the crypto layer with an opaque
error, and a browser-supplied URL is used by the engine's outbound `fetch`.
The URL is therefore required to be a public HTTPS origin with no
credentials or IP literal — a push service is always such a URL, so the
check costs nothing in compatibility and closes the obvious SSRF shapes.
*/

import type { PushSubscriptionDto } from '../types';
import { EngineError } from './errors';
import { base64UrlToBytes } from './push-encoding';

const MAX_ENDPOINT_LENGTH = 1024;
const UA_PUBLIC_KEY_BYTES = 65;
const AUTH_SECRET_BYTES = 16;

function invalid(detail: string): EngineError {
  return new EngineError(`Invalid push subscription: ${detail}`, 400, 'validation');
}

function isIpLiteral(hostname: string): boolean {
  if (/^\[[0-9a-f:.]+\]$/i.test(hostname)) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
Parses a `PushSubscription.toJSON()` body into the bridge's DTO.

An absent `expirationTime` is normal — most browsers never set one — and a
value that is not a finite number is rejected rather than silently stored.
*/
export function parsePushSubscription(input: Record<string, unknown>): PushSubscriptionDto {
  const { endpoint, keys, expirationTime } = input;
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw invalid('endpoint');
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw invalid('endpoint');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === 'localhost' ||
    isIpLiteral(url.hostname) ||
    url.hash !== ''
  ) {
    throw invalid('endpoint');
  }
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) throw invalid('keys');
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') throw invalid('keys');
  if (base64UrlToBytes(p256dh)?.length !== UA_PUBLIC_KEY_BYTES) throw invalid('p256dh');
  if (base64UrlToBytes(auth)?.length !== AUTH_SECRET_BYTES) throw invalid('auth');
  const expires = expirationTime === undefined || expirationTime === null ? null : expirationTime;
  if (expires !== null && (typeof expires !== 'number' || !Number.isFinite(expires))) throw invalid('expirationTime');
  return { endpoint, keys: { p256dh, auth }, expirationTime: expires };
}
