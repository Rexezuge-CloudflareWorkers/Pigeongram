import { Hono } from 'hono';
import { ENGINE_OBJECT_NAME } from './session/engine';

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
Everything else in `/api/*` lives in the session engine Durable Object.
*/
app.all('/api/*', async (c) => {
  try {
    const id = c.env.SESSION_ENGINE.idFromName(ENGINE_OBJECT_NAME);
    const stub = c.env.SESSION_ENGINE.get(id);
    return await stub.fetch(c.req.raw);
  } catch (error) {
    console.error('[worker] session engine unreachable', error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Session engine unreachable: ${message}` }, 503);
  }
});

export default app;
