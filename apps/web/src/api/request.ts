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
The HTTP status a bridge code stands for, so a batched failure arrives with
the same shape a direct one does: the thread controller tells a chat Telegram
no longer offers (`not_found`) from a read that merely failed.
*/
const CODE_STATUS: Readonly<Record<string, number>> = {
  validation: 400,
  not_found: 404,
  invite_expired: 404,
  invite_invalid: 404,
  access: 403,
  conflict: 409,
  rate_limited: 429,
  upstream: 502,
  unavailable: 503,
};

/**
The result of one batched call, or a thrown failure.
*/
export function batchResult<T>(outcome: RpcBatchOutcome | undefined, what: string): T {
  if (!outcome || !outcome.ok) {
    const status = CODE_STATUS[outcome?.code ?? ''] ?? 500;
    throw new HttpStatusError(status, outcome?.error ?? `The ${what} Could Not Be Read`, outcome?.code ?? null);
  }
  return outcome.result as T;
}
