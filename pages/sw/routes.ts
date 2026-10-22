/**
 * The service worker's routing rules, as pure functions.
 *
 * They live apart from the worker itself so the node test project can assert
 * them. These rules are what keep the Cloudflare Access gate intact: a
 * regression here is a security regression, not a cosmetic one.
 */

/**
 * The precached shell: the document every navigation falls back to when the
 * network is gone.
 *
 * It is the very file Cloudflare Pages serves for a pathname route, so the
 * offline app boots exactly like the online one — the same reason the repo has
 * no `404.html` and relies on the Pages fallback.
 */
export const SHELL_URL = '/index.html';

/**
 * The prefixes the service worker never answers from a cache and never falls
 * back to the shell.
 *
 * `/user/*` is the account API behind Cloudflare Access, and `/user/login` is a
 * navigation that has to reach the edge so Access can run its login flow:
 * answering it with the cached shell would swallow the redirect, and the
 * sign-in would silently never happen. `/api/*` is the public health plane.
 */
const PASSTHROUGH_PREFIXES = ['/user', '/api'];

/**
 * Whether a path belongs to the API plane rather than to the app shell.
 *
 * The prefixes are matched on a path-segment boundary, so `/usersettings` is
 * the app's own path and not the account plane.
 */
export function isPassthroughPath(pathname: string): boolean {
  return PASSTHROUGH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
