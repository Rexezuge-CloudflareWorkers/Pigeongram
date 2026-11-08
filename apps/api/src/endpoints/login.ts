import type { ApiContext } from '../types';

/**
 * Cloudflare Access entry point.
 *
 * Access sends the browser here after its login flow. The redirect target is a
 * same-origin pathname carried in `next`, so a bookmarked chat survives the
 * round trip; anything else falls back to `/` rather than turning the entry
 * point into an open redirect.
 */
export function loginHandler(c: ApiContext): Response {
  return c.redirect(safeReturnPath(c.req.raw));
}

function safeReturnPath(request: Request): string {
  const next = new URL(request.url).searchParams.get('next');
  if (next === null || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\r\n]/.test(next)) {
    return '/';
  }
  const origin = new URL(request.url).origin;
  let target: URL;
  try {
    target = new URL(next, origin);
  } catch {
    return '/';
  }
  if (target.origin !== origin || target.pathname === '/user/login' || target.pathname.startsWith('/user/login/')) return '/';
  return `${target.pathname}${target.search}${target.hash}`;
}
