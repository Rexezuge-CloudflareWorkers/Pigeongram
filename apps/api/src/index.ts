import { Hono } from 'hono';
import { ENGINE_OBJECT_NAME } from '@pigeongram/backend-services';
import { readEngineConfig } from '@pigeongram/backend-services/session/config';
import { errorResponse } from '@pigeongram/backend-services/session/http';
import { log } from '@pigeongram/backend-services/session/log';
import { parseUploadGroupSpec, parseUploadSpec } from '@pigeongram/backend-services/session/upload-spec';
import { requireAccess } from './access';

// Wrangler discovers the Durable Object class through this re-export.

const app = new Hono<{ Bindings: CloudflareEnv }>();

/**
 * Public liveness. The `/api/*` plane carries no Cloudflare Access gate and no
 * account data; health is its only route today.
 */
app.get('/api/health', (c) => c.json({ status: 'ok', service: 'telegram-web-client' }));

/**
 * Cloudflare Access gate for `/user/*`.
 *
 * Access authenticates the browser at the Pages edge and forwards a signed
 * `Cf-Access-Jwt-Assertion` header; this verifies that token before anything
 * reaches the session engine. The check lives in the worker, not the Pages
 * Function, because the worker is the last reachable point before the Durable
 * Object — a misconfigured proxy must not expose the account's session.
 */
app.use('/user/*', async (c, next) => {
  const rejection = await requireAccess(c.req.raw, c.env);
  if (rejection) return rejection;
  await next();
});

/**
 * Cloudflare Access entry point.
 *
 * The public intro page cannot know whether an Access session exists until it
 * probes `/user/state`, so its sign-in button navigates here. Access runs its
 * login flow and redirects back to this URL; the route then returns the
 * browser to the SPA, preserving the path the visitor arrived on.
 */
app.get('/user/login', (c) => c.redirect(safeReturnPath(c.req.raw)));

/**
 * Reads the `next` parameter of the Access entry point.
 *
 * Only a same-origin absolute path is allowed: a protocol-relative URL, a
 * backslash (which browsers normalize to a slash) or a scheme would turn the
 * login endpoint into an open redirect.
 */
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
  if (target.origin !== origin) return '/';
  // Returning to the entry point itself would make the browser follow an
  // endless redirect loop.
  if (target.pathname === '/user/login' || target.pathname.startsWith('/user/login/')) return '/';
  return `${target.pathname}${target.search}${target.hash}`;
}

/**
 * Upload pre-flight.
 *
 * workerd reads a request body after the response it belongs to has been sent
 * whenever a Durable Object answers without consuming that body
 * (cloudflare/workerd#918); the uncaught exception can reset the object. So
 * the engine's own parser runs here as well: malformed and oversized uploads
 * are rejected at the edge, and only uploads the engine will actually stream
 * into mtcute ever cross the service binding.
 */
app.post('/user/upload', async (c, next) => {
  try {
    parseUploadSpec(new URL(c.req.url), c.req.raw, readEngineConfig(c.env));
  } catch (error) {
    return errorResponse(error);
  }
  await next();
});

app.post('/user/upload-group', async (c, next) => {
  try {
    parseUploadGroupSpec(new URL(c.req.url), c.req.raw, readEngineConfig(c.env));
  } catch (error) {
    return errorResponse(error);
  }
  await next();
});

/**
Everything else in `/user/*` lives in the session engine Durable Object.
*/
app.all('/user/*', async (c) => {
  try {
    const id = c.env.SESSION_ENGINE.idFromName(ENGINE_OBJECT_NAME);
    const stub = c.env.SESSION_ENGINE.get(id);
    const response = await stub.fetch(c.req.raw);
    // An engine failure can leave the upload half-read; cancelling the body
    // stops workerd's pending pump from reading a stream whose response is
    // already on its way out.
    await discardRequestBody(c.req.raw);
    return response;
  } catch (error) {
    log.error('worker.engine_unreachable', { error });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Session engine unreachable: ${message}`, code: 'unavailable' }, 503);
  }
});

async function discardRequestBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // The body was consumed, aborted or never existed; nothing left to drain.
  }
}

export default app;

export { SessionEngine } from '@pigeongram/backend-services';
