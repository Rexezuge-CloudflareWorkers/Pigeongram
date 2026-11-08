import { ENGINE_OBJECT_NAME } from '@pigeongram/backend-services';
import { EngineError } from '@pigeongram/backend-services/session/errors';
import { errorResponse } from '@pigeongram/backend-services/session/http';
import { log } from '@pigeongram/backend-services/session/log';
import { CORRELATION_ID_HEADER } from '@pigeongram/backend-runtime/constants';
import type { ApiContext } from '../types';

/**
 * Forward a `/user/*` request to the session engine.
 *
 * The Durable Object hands out one event at a time, so this handler does as
 * little as possible: it copies the request, stamps the correlation id the
 * engine logs with, and returns the engine's response. The id is re-applied
 * because a Durable Object subrequest response has immutable headers.
 */
export async function engineHandler(c: ApiContext): Promise<Response> {
  return forwardToEngine(c);
}

/**
 * The shared forwarding path.
 *
 * The upload routes validate at the edge and then land here, which is why it is
 * exported rather than inlined in {@link engineHandler}: the pre-flight and the
 * proxy must remain one implementation.
 */
export async function forwardToEngine(c: ApiContext): Promise<Response> {
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
    return errorResponse(new EngineError('Session Engine Unreachable', 503, 'unavailable'), correlationId);
  }
}

function withCorrelationId(response: Response, correlationId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(CORRELATION_ID_HEADER, correlationId);
  const init: ResponseInit & { webSocket?: WebSocket | null } = {
    status: response.status,
    statusText: response.statusText,
    headers,
  };
  // A `101` carries the accepted socket; rebuilding the response without it
  // would answer the upgrade with an empty handshake.
  if (response.webSocket) init.webSocket = response.webSocket;
  return new Response(response.body, init);
}

/**
 * Drain a request body the Durable Object answered without consuming.
 *
 * workerd reads the stream after the response when a Durable Object returns
 * without reading it (cloudflare/workerd#918); cancelling is what keeps that
 * read from surfacing as an unhandled rejection.
 */
async function discardRequestBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // The body was consumed, aborted or never existed; nothing left to drain.
  }
}
