import type { TelegramClient } from '@mtcute/core/client.js';
import { log } from './log';
import { rpcErrorText } from './rpc-errors';

/**
 * Peer resolution for the bridge.
 *
 * Telegram's `min` user/channel constructors carry a reduced access hash that
 * may only be used inside an `inputPeer*FromMessage`; using it in a regular
 * call answers `PEER_ID_INVALID`. mtcute stores those peers, and its in-memory
 * peer cache hands the cached input peer back from `storage.peers.getById`
 * without the `isMin` check its SQLite branch has. A chat that is a dialog —
 * a full peer in storage — can therefore start answering `PEER_ID_INVALID`
 * after a min copy of it arrived from a group's or channel's message list,
 * because `resolvePeer` takes the cache first and `messages.getHistory` sends
 * the min hash.
 *
 * `getCompleteById` prefers the same cache, and a peer that was ever stored
 * complete keeps its full entity beside the poisoned input peer, so the entry
 * can be replaced without a round trip. When there is no full entity to
 * re-store, `resolvePeer(id, true)` skips the cache and refreshes the entry
 * from Telegram (by username, phone, or a zero access hash).
 *
 * See `@mtcute/core@0.32.5` `highlevel/storage/service/peers.js` (`store` and
 * `getById`) and `highlevel/methods/users/resolve-peer.js`.
 */

/**
 * The failures that mean "the input peer this call carried is not usable".
 * A rejected peer was never acted on, so retrying the call is safe.
 */
const PEER_ERRORS = new Set(['PEER_ID_INVALID', 'CHANNEL_INVALID', 'USER_ID_INVALID']);

/**
 * The peer ids a bridge call addresses: the source chat and, for a forward,
 * the destination. Every other parameter is validated where it is used.
 */
export function peerIdsIn(params: unknown): number[] {
  if (typeof params !== 'object' || params === null) return [];
  const record = params as Record<string, unknown>;
  return [record.chatId, record.toChatId].filter(
    (value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0,
  );
}

/**
 * Whether Telegram rejected the call's input peer, as opposed to any other
 * failure (a flood wait, a permission error, a real missing message).
 */
export function isPeerRejected(error: unknown): boolean {
  const text = rpcErrorText(error);
  return text !== null && PEER_ERRORS.has(text);
}

/**
 * Replaces a poisoned peer cache entry, or refreshes it from Telegram.
 *
 * Best effort: a heal that fails leaves the retried call to report its own
 * error, which is more useful than a healing failure.
 */
export async function refreshPeer(client: TelegramClient, peerId: number): Promise<void> {
  try {
    const [input, complete] = await Promise.all([client.storage.peers.getById(peerId), client.storage.peers.getCompleteById(peerId, true)]);
    const min = complete !== null && 'min' in complete && complete.min === true;
    const inputHash = input !== null && 'accessHash' in input ? input.accessHash : undefined;
    const completeHash = complete !== null && 'accessHash' in complete ? complete.accessHash : undefined;
    if (!min && complete !== null && inputHash !== undefined && completeHash !== undefined && !inputHash.eq(completeHash)) {
      // The cached input peer carries a min (or older) hash while the complete
      // entity beside it is the full one: re-storing replaces the cache entry
      // and the row without asking Telegram.
      await client.storage.peers.store(complete);
      return;
    }
  } catch {
    // Fall through to the network path.
  }
  await client.resolvePeer(peerId, true).catch(() => {});
}

/**
 * Runs a peer-addressed call and retries it once when Telegram rejects the
 * input peer it carried, after refreshing that peer.
 *
 * One retry, not a loop: a peer that is still rejected after a refresh is not
 * going to become usable within the request, and the caller should see the
 * error.
 */
export async function withPeerRetry<T>(client: TelegramClient, peerIds: readonly number[], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (peerIds.length === 0 || !isPeerRejected(error)) throw error;
    log.warn('peer.refreshing', { peerIds, error: rpcErrorText(error) });
    await Promise.all(peerIds.map((peerId) => refreshPeer(client, peerId)));
    return run();
  }
}
