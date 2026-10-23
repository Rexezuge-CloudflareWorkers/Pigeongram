import type { TelegramClient } from '@mtcute/core/client.js';
import type { RpcBatchCall, RpcBatchOutcome } from '../rpc-types';
import { peerIdsIn, withPeerRetry } from './peers';
import { failureText } from './rpc-errors';

/**
 * The `batch` method: several reads in one request.
 *
 * The calls run concurrently over the one Telegram connection: a batch is the
 * only way to overlap them, because the Durable Object hands out one event at
 * a time and separate requests would queue behind each other instead.
 *
 * A failed call is reported on its own, so one broken read never takes the
 * reads beside it down with it.
 */
export async function dispatchBatch(
  client: TelegramClient,
  calls: readonly RpcBatchCall[],
  run: (method: string, params: unknown) => Promise<unknown>,
): Promise<{ results: RpcBatchOutcome[] }> {
  const results = await Promise.all(
    calls.map(async (call) => {
      try {
        // The per-call wrapper is what retries a call whose peer Telegram
        // rejected; a batch reports failures per call, so the retry cannot
        // live above it.
        const result = await withPeerRetry(client, peerIdsIn(call.params), () => run(call.method, call.params));
        return { ok: true, result } satisfies RpcBatchOutcome;
      } catch (error) {
        return { ok: false, error: failureText(error) } satisfies RpcBatchOutcome;
      }
    }),
  );
  return { results };
}
