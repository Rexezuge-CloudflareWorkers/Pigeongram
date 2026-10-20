import { Hono } from 'hono';
import { requireAccess } from './access';
import { ENGINE_OBJECT_NAME } from './session/engine';
import { errorResponse } from './session/http';
import { parseUploadSpec } from './session/media-routes';

// Wrangler discovers the Durable Object class through this re-export.
export { SessionEngine } from './session/engine';

const app = new Hono<{ Bindings: CloudflareEnv }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'telegram-web-client' }));

/**
 * Cloudflare Access gate for `/api/*`.
 *
 * Access authenticates the browser at the Pages edge and forwards a signed
 * `Cf-Access-Jwt-Assertion` header; this verifies that token before anything
 * reaches the session engine. The check lives in the worker, not the Pages
 * Function, because the worker is the last reachable point before the Durable
 * Object — a misconfigured proxy must not expose the account's session.
 * `/health` stays public because it exposes no account data.
 */
app.use('/api/*', async (c, next) => {
  const rejection = await requireAccess(c.req.raw, c.env);
  if (rejection) return rejection;
  await next();
});

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
app.post('/api/upload', async (c, next) => {
  try {
    parseUploadSpec(new URL(c.req.url), c.req.raw, c.env);
  } catch (error) {
    return errorResponse(error);
  }
  await next();
});

/**
Everything else in `/api/*` lives in the session engine Durable Object.
*/
app.all('/api/*', async (c) => {
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
    console.error('[worker] session engine unreachable', error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Session engine unreachable: ${message}` }, 503);
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
