import { CORRELATION_ID_HEADER } from '@pigeongram/backend-runtime/constants';
import type { Next } from 'hono';
import type { ApiContext } from '../types';

/**
 * Resolve one correlation id per request and return it on the response.
 *
 * An inbound id is reused so a caller can follow its own request through the
 * worker and the Durable Object; otherwise the edge mints one. The id travels
 * as a header only — the bridge body is the caller's contract, and a transport
 * concern in it would make every error shape carry it.
 */
export async function correlationMiddleware(c: ApiContext, next: Next): Promise<void> {
  const correlationId = c.req.header(CORRELATION_ID_HEADER) ?? crypto.randomUUID();
  c.set('correlationId', correlationId);
  await next();
  if (!c.res) return;
  // A Durable Object response can carry immutable headers; `withCorrelationId`
  // already rebuilds that one, but a future handler must not turn a missing
  // header into a failed request.
  try {
    c.res.headers.set(CORRELATION_ID_HEADER, correlationId);
  } catch {
    // The header is advisory; the request itself already succeeded.
  }
}
