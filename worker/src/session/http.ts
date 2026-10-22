import { EngineError, isStorageWriteQuotaError, STORAGE_WRITE_QUOTA_MESSAGE } from './errors';
import { EngineConfigError } from './mtproto/client';

/**
 * HTTP plumbing shared by the engine's bridge routes: request bodies in,
 * error responses out. Kept apart from the Durable Object so the class itself
 * stays about the session, not about JSON handling.
 */

/**
Reads a JSON body that must be an object; malformed input is a 400.
*/
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    throw new EngineError('Request body must be JSON', 400);
  }
}

/**
Maps engine errors onto the bridge's JSON error responses.
*/
export function errorResponse(error: unknown): Response {
  if (error instanceof EngineError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof EngineConfigError) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  if (isStorageWriteQuotaError(error)) {
    // The account is over the Free plan's daily row budget. Reads keep
    // working, so the failure gets its own code instead of a generic 500.
    console.warn('[engine] storage write quota exhausted');
    return Response.json({ code: 'storage_write_quota', error: STORAGE_WRITE_QUOTA_MESSAGE }, { status: 503 });
  }
  console.error('[engine] request failed', error);
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status: 500 });
}
