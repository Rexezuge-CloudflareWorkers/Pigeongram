import { EnvParser } from '@pigeongram/backend-runtime/config';
import { DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT_PER_MINUTE } from '@pigeongram/backend-runtime/constants';
import { rateLimit, securityHeaders, sensitivePaths } from '@rexezuge/http';
import type { RateLimitHandler } from '@rexezuge/http';
import type { MiddlewareHandler } from 'hono';
import type { ApiEnv } from '../types';

/**
 * The account plane's `/user/*` budget: RPC, login, state, uploads and the
 * socket upgrade.
 *
 * `max` is a resolver rather than a number because the route table is built in
 * the worker constructor, where `env` does not exist yet; a number read there
 * would be a module constant wearing a configuration variable's name. The SDK
 * limiter keys on the Access identity when the context carries one and on
 * `CF-Connecting-IP` otherwise, and never trusts `X-Forwarded-For`.
 */
const ACCOUNT_LIMIT: RateLimitHandler = rateLimit({
  windowMs: 60_000,
  max: (c) => EnvParser.positiveInt(c.env, 'RATE_LIMIT_PER_MINUTE', String(DEFAULT_RATE_LIMIT_PER_MINUTE)),
  keyPrefix: 'user-api',
});

/**
 * The media plane's budget, in its own bucket.
 *
 * Every avatar and every byte-range is one request, and a chat-list paint plus
 * a media-heavy thread issues them by the dozen. Sharing the account budget
 * gave normal browsing a `429 RateLimited` long before it looked like abuse;
 * a separate, larger budget keeps the throttle meaningful without starving
 * images.
 */
const MEDIA_LIMIT: RateLimitHandler = rateLimit({
  windowMs: 60_000,
  max: (c) => EnvParser.positiveInt(c.env, 'MEDIA_RATE_LIMIT_PER_MINUTE', String(DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE)),
  keyPrefix: 'user-media',
});

/**
 * The two side-effect-free media routes the bridge serves. They are named here
 * rather than derived from the route table because this middleware runs on the
 * whole `/user/*` prefix before a route is matched; a new media route has to be
 * added here as well, and `test/worker.test.ts` pins the split.
 */
const MEDIA_PATHS: ReadonlySet<string> = new Set(['/user/file', '/user/avatar']);

/**
 * The `/user/*` throttle: the media routes draw on the media budget, everything
 * else on the account budget. Two buckets, two key prefixes, so a burst of
 * images can never spend an RPC call's allowance.
 */
export const USER_API_LIMIT: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const limiter = MEDIA_PATHS.has(c.req.path) ? MEDIA_LIMIT : ACCOUNT_LIMIT;
  return limiter(c, next);
};

/**
 * Baseline response headers.
 *
 * `/user/` is the account plane: every response under it carries the Access
 * session, so a shared proxy must never cache one. The public `/api/health`
 * plane stays cacheable. The predicate is named rather than defaulted because
 * both wrong answers are silent — caching credentials, or applying `no-store`
 * to the public plane forever.
 */
export const securityHeadersMiddleware = securityHeaders(sensitivePaths('/user/'));
