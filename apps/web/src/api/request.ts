import { ApiError, apiError } from '../api-error';
import type { RpcBatchCall, RpcBatchOutcome, RpcMethod } from '../types';

/**
 * The bridge's transport: one JSON request, one RPC envelope, and the batch
 * that carries several reads in one Durable Object event. The domain modules
 * beside this one name the methods; nothing here knows what a chat is.
 */

/**
 * Sends one request and parses its JSON body.
 *
 * A body that is not JSON yields `null` rather than throwing: the caller
 * decides whether that is a failure, and `/user/state` treats it as one (an
 * Access login page answers `200` with HTML).
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['content-type'] = 'application/json';

  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw apiError(response.status, payload);
  }
  return payload as T;
}

/**
 * Runs one bridge method.
 */
export const rpc = <T>(method: RpcMethod, params?: Record<string, unknown>): Promise<T> =>
  request<T>('/user/rpc', { method: 'POST', body: JSON.stringify({ method, params }) });

/**
Runs several read-only calls in one request.

The session engine is a Durable Object, and a Durable Object hands out one
event at a time: two separate requests would queue behind each other, and
each Telegram round trip would be paid in turn. One batch is one event, and
the calls inside it run concurrently over the same Telegram connection.

Only the read-only methods may be batched. A write would have no defined
completion order, and Telegram's own ordering guarantees matter more than the
round trip saved.
*/
export async function rpcBatch(calls: readonly RpcBatchCall[]): Promise<RpcBatchOutcome[]> {
  const response = await rpc<{ results: RpcBatchOutcome[] }>('batch', { calls });
  return response.results;
}

/**
The result of one batched call, or a thrown failure.
*/
export function batchResult<T>(outcome: RpcBatchOutcome | undefined, what: string): T {
  if (!outcome || !outcome.ok) {
    throw new ApiError(outcome?.error ?? `The ${what} could not be read`, 500);
  }
  return outcome.result as T;
}
