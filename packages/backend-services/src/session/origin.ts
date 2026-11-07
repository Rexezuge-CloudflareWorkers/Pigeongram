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
    allowed.add(`https://${host.trim()}`);
    allowed.add(`http://${host.trim()}`);
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

  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site') return false;

  return allowedOrigins(request, env).has(origin) || secFetchSite === 'same-origin';
}

export function originRejection(): Response {
  return Response.json({ error: 'Origin not allowed', code: 'access' }, { status: 403 });
}
