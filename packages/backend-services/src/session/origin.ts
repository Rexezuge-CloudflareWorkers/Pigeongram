/**
 * Origin validation for the bridge's CSRF defense.
 *
 * A browser request that carries a session cookie (or an Access assertion) is
 * only acted on when its `Origin` (or `Referer` fallback) names a host the
 * deployment trusts. The check is shared by the worker edge and the Durable
 * Object so a request that bypasses one still fails at the other.
 */

export interface OriginEnv {
  readonly ALLOWED_ORIGINS?: string;
  readonly PAGES_ORIGIN?: string;
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

export function requestOrigin(request: Request): string | null {
  const originHeader = request.headers.get('origin');
  if (originHeader !== null && originHeader.trim() !== '') {
    try {
      return new URL(originHeader.trim()).origin;
    } catch {
      // Fall through to the Referer fallback.
    }
  }
  const referer = request.headers.get('referer');
  if (referer !== null && referer.trim() !== '') {
    try {
      return new URL(referer.trim()).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export function allowedOrigins(request: Request, env: OriginEnv = {}): Set<string> {
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // The request URL is always parseable in practice; ignore otherwise.
  }
  const host = request.headers.get('host');
  if (host !== null && host.trim() !== '') {
    // Only the https form is trusted. The request URL already carries the
    // scheme the edge terminated, so the host fallback exists for a proxy that
    // rewrites the URL; a plain-http form would let a spoofed `Host` match a
    // spoofed `Origin` on a deployment that only ever serves https.
    allowed.add(`https://${host.trim()}`);
  }
  const configured = [env.ALLOWED_ORIGINS ?? '', env.PAGES_ORIGIN ?? '']
    .join(',')
    .split(',')
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => value !== null);
  for (const origin of configured) allowed.add(origin);
  return allowed;
}

export function isOriginAllowed(request: Request, env: OriginEnv = {}): boolean {
  const origin = requestOrigin(request);
  if (origin === null) return false;
  // The allowlist is the only answer. `Sec-Fetch-Site` is not consulted: a
  // client controls both it and `Origin`, so trusting "same-origin" there
  // would let a forged pair through the very check that exists to stop it.
  return allowedOrigins(request, env).has(origin);
}

export function originRejection(): Response {
  // The family's canonical envelope; the edge adds the correlation header.
  return Response.json({ Exception: { Type: 'access', Message: 'Origin not allowed' } }, { status: 403 });
}
