import type { TelegramClient } from '@mtcute/core/client.js';
import { log } from './log';
import { rpcErrorText } from './rpc-errors';

/**
 * Peer resolution for the bridge.
 *
 * Telegram's `min` user/channel constructors carry a reduced access hash that
 * may only be used inside an `inputPeer*FromMessage`; using it in a regular
 * call answers `PEER_ID_INVALID` (a user) or `CHANNEL_INVALID` (a channel).
 * mtcute stores those peers, and its peer cache hands the min input peer back
 * from `storage.peers.getById`. A chat that is a dialog — a full peer in
 * storage — can therefore start answering `CHANNEL_INVALID` after a min copy
 * of it arrived from a group's or channel's message list, because
 * `resolvePeer` takes the cache first and the call sends the min hash.
 *
 * Three escalating repairs, cheapest first:
 *
 * 1. A peer that was ever stored complete keeps its full entity beside the
 *    poisoned input peer, so the entry can be replaced without a round trip.
 * 2. `resolvePeer(id, true)` skips the cache and refreshes from Telegram by
 *    username or a zero access hash — enough for a public channel or a user.
 * 3. Neither helps for a channel with no username whose cache holds only the
 *    min entity: Telegram refuses the zero hash, so the only place the full
 *    entity can come from is a response that carries it, which is the dialog
 *    list. `iterDialogs` reads it, the response refills the cache, and the
 *    full entity is re-stored.
 *
 * `findDialogs` is deliberately not the last resort: it resolves through the
 * same poisoned cache and calls `messages.getPeerDialogs` with the bad hash,
 * so it throws before reaching its own dialog fallback.
 *
 * Guarding the peers repository against a min overwrite would not help
 * either: mtcute's `PeersService` keeps an LruMap of input peers that it fills
 * from the same `store()` call and reads before the repository, so the
 * poisoning has to be repaired, not prevented.
 *
 * See `@mtcute/core@0.32.7` `highlevel/storage/service/peers.js` (`store`,
 * `getById`) and `highlevel/methods/users/resolve-peer.js`.
 */

/**
 * The failures that mean "the input peer this call carried is not usable".
 * A rejected peer was never acted on, so retrying the call is safe.
 */
const PEER_ERRORS = new Set(['PEER_ID_INVALID', 'CHANNEL_INVALID', 'USER_ID_INVALID']);

/**
 * How many dialogs the last-resort scan may read. A chat the account still
 * holds is normally in the first pages; past this point the account has
 * probably left it, and a longer read would only make the failing request
 * slower.
 */
const DIALOG_SCAN_LIMIT = 500;

/**
 * The peer ids a bridge call addresses: the source chat, a forward's
 * destination, and a global search's cursor chat. Every other parameter is
 * validated where it is used.
 */
export function peerIdsIn(params: unknown): number[] {
  if (typeof params !== 'object' || params === null) return [];
  const record = params as Record<string, unknown>;
  const offset = typeof record.offset === 'object' && record.offset !== null ? (record.offset as Record<string, unknown>) : null;
  return [record.chatId, record.toChatId, offset?.chatId].filter(
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
 * How a heal repaired the peer, or `none` when it could not.
 */
export type PeerHeal = 'cache' | 'resolve' | 'dialogs' | 'none';

/**
 * Replaces a poisoned peer cache entry, or refreshes it from Telegram.
 *
 * Re-storing a full entity is what repairs the cache: mtcute's `store()` is
 * the only path that rewrites both the row and the input peer it hands out.
 */
export async function refreshPeer(client: TelegramClient, peerId: number): Promise<PeerHeal> {
  try {
    const complete = await client.storage.peers.getCompleteById(peerId, true);
    const input = await client.storage.peers.getById(peerId);
    const min = complete !== null && 'min' in complete && complete.min === true;
    const inputHash = input !== null && 'accessHash' in input ? input.accessHash : undefined;
    const completeHash = complete !== null && 'accessHash' in complete ? complete.accessHash : undefined;
    if (!min && complete !== null && inputHash !== undefined && completeHash !== undefined && !inputHash.eq(completeHash)) {
      await client.storage.peers.store(complete);
      return 'cache';
    }
  } catch {
    // Fall through to the next repair.
  }

  try {
    await client.resolvePeer(peerId, true);
    const complete = await client.storage.peers.getCompleteById(peerId, true);
    const min = complete === null || ('min' in complete && complete.min === true);
    if (!min) {
      await client.storage.peers.store(complete);
      return 'resolve';
    }
  } catch {
    // Fall through to the dialog scan.
  }

  return scanDialogs(client, peerId);
}

/**
 * Reads the dialog list until the chat shows up, then re-stores what the
 * response left in the cache.
 *
 * A chat that is not in either folder is one this account no longer holds;
 * `none` is the answer, and the retried call reports Telegram's own refusal.
 */
async function scanDialogs(client: TelegramClient, peerId: number): Promise<PeerHeal> {
  try {
    let seen = 0;
    for await (const dialog of client.iterDialogs({ archived: 'keep', limit: DIALOG_SCAN_LIMIT })) {
      seen += 1;
      if (dialog.peer.id !== peerId) continue;
      const complete = await client.storage.peers.getCompleteById(peerId, true);
      if (complete === null || ('min' in complete && complete.min === true)) return 'none';
      await client.storage.peers.store(complete);
      return 'dialogs';
    }
    if (seen === 0) return 'none';
  } catch {
    // A dialog read can fail on its own; the retried call reports the original.
  }
  return 'none';
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
    const healed = await Promise.all(peerIds.map(async (peerId) => refreshPeer(client, peerId)));
    const via = healed.includes('cache')
      ? 'cache'
      : healed.includes('resolve')
        ? 'resolve'
        : healed.includes('dialogs')
          ? 'dialogs'
          : 'none';
    log.warn('peer.refreshed', { peerIds, error: rpcErrorText(error), via });
    return run();
  }
}
