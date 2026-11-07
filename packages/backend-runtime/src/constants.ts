/**
 * Cross-boundary constants.
 *
 * These are the names and defaults the worker edge and the Durable Object must
 * agree on. Keeping them here means a header rename or a changed rate-limit
 * default is one edit, not a search across two layers.
 */

/**
 * The header that carries one request's correlation id.
 *
 * The id travels as a header only: the JSON body is the bridge's own contract,
 * and a body field would make every error shape carry a transport concern.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * The per-minute request budget for `/user/*` when `RATE_LIMIT_PER_MINUTE` is
 * absent or unusable.
 */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
