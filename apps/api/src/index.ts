import { Hono } from 'hono';
import { ENGINE_OBJECT_NAME } from '@pigeongram/backend-services';
import { readEngineConfig } from '@pigeongram/backend-services/session/config';
import { errorResponse } from '@pigeongram/backend-services/session/http';
import { isOriginAllowed } from '@pigeongram/backend-services/session/origin';
import { log } from '@pigeongram/backend-services/session/log';
import { parseUploadGroupSpec, parseUploadSpec } from '@pigeongram/backend-services/session/upload-spec';
import { EnvParser } from '@pigeongram/backend-runtime/config';
import { CORRELATION_ID_HEADER, DEFAULT_RATE_LIMIT_PER_MINUTE } from '@pigeongram/backend-runtime/constants';
import { requireAccess } from './access';
import { checkRateLimit, rateLimitKey } from './rate-limit';

// Wrangler discovers the Durable Object class through this re-export.

const app = new Hono<{ Bindings: CloudflareEnv; Variables: { correlationId: string } }>();

app.use('*', async (c, next) => {
  const correlationId = c.req.header(CORRELATION_ID_HEADER) ?? crypto.randomUUID();
  c.set('correlationId', correlationId);
  await next();
  if (!c.res) return;
  c.res.headers.set(CORRELATION_ID_HEADER, correlationId);
  if (!c.res.headers.has('x-content-type-options')) c.res.headers.set('x-content-type-options', 'nosniff');
  if (!c.res.headers.has('x-frame-options')) c.res.headers.set('x-frame-options', 'DENY');
  if (!c.res.headers.has('referrer-policy')) c.res.headers.set('referrer-policy', 'no-referrer');
  if (!c.res.headers.has('permissions-policy')) c.res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  const environment = (c.env.ENVIRONMENT ?? '').toLowerCase();
  if (environment === 'production' && !c.res.headers.has('strict-transport-security')) {
    c.res.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  // Content-Security-Policy frame-ancestors as the modern equivalent.
  if (!c.res.headers.has('content-security-policy')) {
    c.res.headers.set('content-security-policy', "frame-ancestors 'none'");
  }
});

/**
 * Public liveness. The `/api/*` plane carries no Cloudflare Access gate and no
 * account data; health is its only route today.
 */
app.get('/api/health', (c) => c.json({ status: 'ok', service: 'telegram-web-client' }));

/**
 * Cloudflare Access gate for `/user/*`.
 */
app.use('/user/*', async (c, next) => {
  const rejection = await requireAccess(c.req.raw, c.env);
  if (rejection) {
    rejection.headers.set(CORRELATION_ID_HEADER, c.get('correlationId'));
    return rejection;
  }
  await next();
});

app.use('/user/*', async (c, next) => {
  const method = c.req.method;
  const isWebSocketUpgrade = method === 'GET' && new URL(c.req.url).pathname === '/user/updates';
  if ((method === 'POST' || isWebSocketUpgrade) && !isOriginAllowed(c.req.raw, c.env)) {
    const response = Response.json({ error: 'Origin not allowed', code: 'access' }, { status: 403 });
    response.headers.set(CORRELATION_ID_HEADER, c.get('correlationId'));
    return response;
  }
  const limit = EnvParser.positiveInt(c.env, 'RATE_LIMIT_PER_MINUTE', String(DEFAULT_RATE_LIMIT_PER_MINUTE));
  const result = checkRateLimit(rateLimitKey(c.req.raw, null), limit);
  if (!result.allowed) {
    const response = Response.json({ error: 'Too many requests', code: 'access' }, { status: 429 });
    response.headers.set('retry-after', String(result.retryAfterSeconds));
    response.headers.set(CORRELATION_ID_HEADER, c.get('correlationId'));
    return response;
  }
  await next();
  if (c.res && !c.res.headers.has('cache-control')) {
    c.res.headers.set('cache-control', 'no-store');
  }
});

/**
 * Cloudflare Access entry point.
 */
app.get('/user/login', (c) => c.redirect(safeReturnPath(c.req.raw)));

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
  if (target.origin !== origin || target.pathname === '/user/login' || target.pathname.startsWith('/user/login/')) return '/';
  return `${target.pathname}${target.search}${target.hash}`;
}

app.post('/user/upload', async (c, next) => {
  const correlationId = c.get('correlationId');
  try {
    parseUploadSpec(new URL(c.req.url), c.req.raw, readEngineConfig(c.env));
  } catch (error) {
    return errorResponse(error, correlationId);
  }
  await next();
});

app.post('/user/upload-group', async (c, next) => {
  const correlationId = c.get('correlationId');
  try {
    parseUploadGroupSpec(new URL(c.req.url), c.req.raw, readEngineConfig(c.env));
  } catch (error) {
    return errorResponse(error, correlationId);
  }
  await next();
});

app.all('/user/*', async (c) => {
  const correlationId = c.get('correlationId');
  try {
    const id = c.env.SESSION_ENGINE.idFromName(ENGINE_OBJECT_NAME);
    const stub = c.env.SESSION_ENGINE.get(id);
    const request = new Request(c.req.raw);
    request.headers.set(CORRELATION_ID_HEADER, correlationId);
    const response = await stub.fetch(request);
    await discardRequestBody(c.req.raw);
    return withCorrelationId(response, correlationId);
  } catch (error) {
    log.error('worker.engine_unreachable', { error, correlationId });
    const response = Response.json({ error: 'Session Engine Unreachable', code: 'unavailable', correlationId }, { status: 503 });
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    return response;
  }
});

function withCorrelationId(response: Response, correlationId: string): Response {
  // Durable Object subrequest responses have immutable headers in Workers.
  const headers = new Headers(response.headers);
  headers.set(CORRELATION_ID_HEADER, correlationId);
  const init: ResponseInit & { webSocket?: WebSocket | null } = {
    status: response.status,
    statusText: response.statusText,
    headers,
  };
  if (response.webSocket) init.webSocket = response.webSocket;
  return new Response(response.body, init);
}

async function discardRequestBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // The body was consumed, aborted or never existed; nothing left to drain.
  }
}

export default app;

export { SessionEngine } from '@pigeongram/backend-services';
