import { EnvParser } from '@pigeongram/backend-runtime/config';
import { DEFAULT_RATE_LIMIT_PER_MINUTE } from '@pigeongram/backend-runtime/constants';
import { rateLimit, securityHeaders, sensitivePaths } from '@rexezuge/http';
import type { RateLimitHandler } from '@rexezuge/http';

/**
 * The `/user/*` request budget.
 *
 * `max` is a resolver rather than a number because the route table is built in
 * the worker constructor, where `env` does not exist yet; a number read there
 * would be a module constant wearing a configuration variable's name. The SDK
 * limiter keys on the Access identity when the context carries one and on
 * `CF-Connecting-IP` otherwise, and never trusts `X-Forwarded-For`.
 */
export const USER_API_LIMIT: RateLimitHandler = rateLimit({
  windowMs: 60_000,
  max: (c) => EnvParser.positiveInt(c.env, 'RATE_LIMIT_PER_MINUTE', String(DEFAULT_RATE_LIMIT_PER_MINUTE)),
  keyPrefix: 'user-api',
});

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
