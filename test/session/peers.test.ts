import { Long } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it, vi } from 'vitest';
import { isPeerRejected, peerIdsIn, refreshPeer, withPeerRetry } from '../../packages/backend-services/src/session/peers';

/**
 * The mtcute peer cache as the heal sees it: the input peer the cache would
 * hand out, the complete entity stored beside it, and the network resolver.
 */
function fakeClient(input: tl.TypeInputPeer | null, complete: tl.TypeUser | tl.TypeChat | null) {
  const peers = {
    getById: vi.fn(async () => input),
    getCompleteById: vi.fn(async () => complete),
    store: vi.fn(async () => {}),
  };
  const resolvePeer = vi.fn(async () => input ?? ({ _: 'inputPeerUser', userId: 0, accessHash: Long.ZERO } as tl.TypeInputPeer));
  const client = { storage: { peers }, resolvePeer } as unknown as TelegramClient;
  return { client, peers, resolvePeer };
}

function rpcFailure(text: string): Error {
  return Object.assign(new Error(`Telegram API error 400: ${text}`), { text });
}

const minHash = Long.fromString('100');
const fullHash = Long.fromString('200');

const completeUser = { _: 'user', id: 1, min: false, accessHash: fullHash } as unknown as tl.RawUser;
const minUser = { _: 'user', id: 1, min: true, accessHash: minHash } as unknown as tl.RawUser;
const cachedUser = { _: 'inputPeerUser', userId: 1, accessHash: minHash } as tl.TypeInputPeer;

describe('peerIdsIn', () => {
  it('reads the source and destination chat of a call', () => {
    expect(peerIdsIn({ chatId: 5, toChatId: -1_000_000_000_002 })).toEqual([5, -1_000_000_000_002]);
    expect(peerIdsIn({ chatId: 5 })).toEqual([5]);
  });

  it('ignores parameters that name no peer', () => {
    for (const params of [null, undefined, {}, { messageId: 5 }, { chatId: '5' }, { chatId: 0 }, { chatId: 1.5 }]) {
      expect(peerIdsIn(params)).toEqual([]);
    }
  });
});

describe('isPeerRejected', () => {
  it('recognises the failures that mean the input peer is unusable', () => {
    for (const text of ['PEER_ID_INVALID', 'CHANNEL_INVALID', 'USER_ID_INVALID']) {
      expect(isPeerRejected(rpcFailure(text))).toBe(true);
    }
  });

  it('leaves every other failure alone', () => {
    for (const error of [rpcFailure('FLOOD_WAIT_5'), new Error('offline'), null, 'PEER_ID_INVALID']) {
      expect(isPeerRejected(error)).toBe(false);
    }
  });
});

describe('withPeerRetry', () => {
  it('replaces a poisoned cache entry from the full entity and retries', async () => {
    const { client, peers, resolvePeer } = fakeClient(cachedUser, completeUser);
    const run = vi.fn().mockRejectedValueOnce(rpcFailure('PEER_ID_INVALID')).mockResolvedValueOnce('opened');

    await expect(withPeerRetry(client, [1], run)).resolves.toBe('opened');

    expect(peers.store).toHaveBeenCalledWith(completeUser);
    expect(resolvePeer).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('refreshes from Telegram when no full entity is cached', async () => {
    const { client, peers, resolvePeer } = fakeClient(null, null);
    const run = vi.fn().mockRejectedValueOnce(rpcFailure('PEER_ID_INVALID')).mockResolvedValueOnce('opened');

    await expect(withPeerRetry(client, [1], run)).resolves.toBe('opened');

    expect(peers.store).not.toHaveBeenCalled();
    expect(resolvePeer).toHaveBeenCalledWith(1, true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('refreshes from Telegram when the cached peer is only a min entity', async () => {
    const { client, peers, resolvePeer } = fakeClient(null, minUser);
    const run = vi.fn().mockRejectedValueOnce(rpcFailure('CHANNEL_INVALID')).mockResolvedValueOnce('opened');

    await expect(withPeerRetry(client, [1], run)).resolves.toBe('opened');

    expect(peers.store).not.toHaveBeenCalled();
    expect(resolvePeer).toHaveBeenCalledWith(1, true);
  });

  it('does not retry a failure that is not about the peer', async () => {
    const { client, resolvePeer } = fakeClient(cachedUser, completeUser);
    const run = vi.fn().mockRejectedValue(rpcFailure('FLOOD_WAIT_5'));

    await expect(withPeerRetry(client, [1], run)).rejects.toThrow('FLOOD_WAIT_5');

    expect(resolvePeer).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not retry a call that names no peer', async () => {
    const { client } = fakeClient(cachedUser, completeUser);
    const run = vi.fn().mockRejectedValue(rpcFailure('PEER_ID_INVALID'));

    await expect(withPeerRetry(client, [], run)).rejects.toThrow('PEER_ID_INVALID');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports the second failure instead of looping', async () => {
    const { client } = fakeClient(cachedUser, completeUser);
    const run = vi.fn().mockRejectedValue(rpcFailure('PEER_ID_INVALID'));

    await expect(withPeerRetry(client, [1], run)).rejects.toThrow('PEER_ID_INVALID');

    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('refreshPeer', () => {
  it('falls back to the network when re-storing the entity fails', async () => {
    const { client, peers, resolvePeer } = fakeClient(cachedUser, completeUser);
    peers.store.mockRejectedValueOnce(new Error('sqlite is busy'));

    await expect(refreshPeer(client, 1)).resolves.toBeUndefined();

    expect(resolvePeer).toHaveBeenCalledWith(1, true);
  });

  it('swallows a failed refresh: the retried call reports the real error', async () => {
    const { client, resolvePeer } = fakeClient(null, null);
    resolvePeer.mockRejectedValueOnce(new Error('peer not found'));

    await expect(refreshPeer(client, 1)).resolves.toBeUndefined();
  });
});
