import { EngineError, isStorageWriteQuotaError, STORAGE_WRITE_QUOTA_MESSAGE } from './errors';
import { EngineConfigError } from '@pigeongram/provider-clients/mtproto/client';
import { log } from './log';

/**
 * HTTP plumbing shared by the engine's bridge routes: request bodies in,
 * error responses out. Kept apart from the Durable Object so the class itself
 * stays about the session, not about JSON handling.
 */

/**
 * How large a JSON request body may be. The bridge's parameters are tiny by
 * contract — a chat id, a message id, a few flags — and parsing a large body
 * would spend the Free plan's 10 ms CPU budget on the attacker's input.
 */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

/**
Reads a JSON body that must be an object; malformed or oversized input is a 400/413.
*/
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_JSON_BODY_BYTES) {
    throw new EngineError('Request body is too large', 413);
  }
  const body = request.body;
  if (!body) {
    throw new EngineError('Request body must be JSON', 400);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new EngineError('Request body is too large', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EngineError('Request body must be JSON', 400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new EngineError('Request body must be JSON', 400);
  }
  return parsed as Record<string, unknown>;
}

/**
Maps engine errors onto the bridge's JSON error responses.
*/
export function errorResponse(error: unknown): Response {
  if (error instanceof EngineError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof EngineConfigError) {
    return Response.json({ error: error.message, code: 'config' }, { status: 503 });
  }
  if (isStorageWriteQuotaError(error)) {
    // The account is over the Free plan's daily row budget. Reads keep
    // working, so the failure gets its own code instead of a generic 500.
    log.warn('storage.quota_exhausted');
    return Response.json({ code: 'storage_write_quota', error: STORAGE_WRITE_QUOTA_MESSAGE }, { status: 503 });
  }
  log.error('request.failed', { error });
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message, code: 'internal' }, { status: 500 });
}
