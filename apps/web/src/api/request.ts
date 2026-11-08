import { createApiClient, HttpStatusError } from '@rexezuge/web/api';
import type { ApiRequestInit } from '@rexezuge/web/api';
import type { RpcBatchCall, RpcBatchOutcome, RpcMethod } from '../types';

/**
 * The bridge's transport: one JSON request, one RPC envelope, and the batch
 * that carries several reads in one Durable Object event. The domain modules
 * beside this one name the methods; nothing here knows what a chat is.
 *
 * The wire work belongs to `@rexezuge/web/api`, the family's shared client:
 * it serialises a body, decodes the canonical `{Exception:{Type,Message}}`
 * envelope (with the legacy `{error, code}` fallback), and throws a
 * `ServiceError` subclass for every failure. The `fetch` wrapper keeps the
 * browser's global reachable, so tests can still replace it with
 * `vi.stubGlobal('fetch', …)`.
 */

const client = createApiClient((input, init) => fetch(input, init), { baseUrl: '' });

/**
 * Sends one request and parses its JSON body.
 *
 * A `204` or an empty body resolves to `undefined`; a body that is not JSON
 * throws an `HttpStatusError`, which the Access probe in `api.ts` translates
 * into the `TypeError` that tells "no engine answer" apart from a bridge
 * error.
 */
export const request = <T>(path: string, init?: ApiRequestInit): Promise<T> => client.request<T>(path, init);

/**
 * Runs one bridge method.
 */
export const rpc = <T>(method: RpcMethod, params?: Record<string, unknown>): Promise<T> =>
  request<T>('/user/rpc', { method: 'POST', body: { method, params } });

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
    throw new HttpStatusError(500, outcome?.error ?? `The ${what} could not be read`, null);
  }
  return outcome.result as T;
}
