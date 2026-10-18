import { Hono } from 'hono';
import { ENGINE_OBJECT_NAME } from './session/engine';
import { errorResponse } from './session/http';
import { parseUploadSpec } from './session/media-routes';

// Wrangler discovers the Durable Object class through this re-export.
export { SessionEngine } from './session/engine';

const app = new Hono<{ Bindings: CloudflareEnv }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'telegram-web-client' }));

/**
 * Shared-secret gate for `/api/*`.
 *
 * Active whenever `SPIKE_TOKEN` is set. It is the only thing standing between
 * the internet and the bridge until the Pages project sits behind Cloudflare
 * Access (and the worker is reached only through that project). Delete the
 * secret once Access is in place.
 */
app.use('/api/*', async (c, next) => {
  const required = (c.env.SPIKE_TOKEN ?? '').trim();
  if (required.length > 0) {
    const provided = c.req.header('x-session-token') ?? new URL(c.req.url).searchParams.get('token') ?? '';
    if (provided !== required) {
      return c.json({ error: 'Missing or wrong session token', code: 'gate' }, 401);
    }
  }
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
