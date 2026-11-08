import type { ApiContext } from '../types';

/**
 * Public liveness.
 *
 * The `/api/*` plane carries no Cloudflare Access gate and no account data;
 * health is its only route today. It deliberately says nothing about the
 * session engine's state — that lives behind `/user/state`.
 */
export function healthHandler(c: ApiContext): Response {
  return c.json({ status: 'ok', service: 'telegram-web-client' });
}
