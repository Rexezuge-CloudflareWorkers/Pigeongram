import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it, vi } from 'vitest';
import { CallRegistry } from '../../packages/backend-services/src/session/call-registry';
import type { EngineError } from '../../packages/backend-services/src/session/errors';
import { dispatchRpc } from '../../packages/backend-services/src/session/rpc';
import { StickerRegistry } from '../../packages/backend-services/src/session/sticker-registry';
import { albumLedger } from './rpc-dispatch';

/**
The chat list's write methods across the real dispatch path.

The SPA's optimistic move is only as good as the Telegram call behind it, so
the folder id and the pin request are worth pinning here rather than leaving
them to a mocked client in a component test.
*/
function stubClient(): { client: TelegramClient; call: ReturnType<typeof vi.fn>; resolvePeer: ReturnType<typeof vi.fn> } {
  const call = vi.fn(async () => ({}));
  const resolvePeer = vi.fn(async (id: number) => ({ _: 'inputPeerUser', userId: id, accessHash: 1n }));
  return { client: { call, resolvePeer } as unknown as TelegramClient, call, resolvePeer };
}

function dispatch(target: TelegramClient, method: string, params: Record<string, unknown>): Promise<unknown> {
  return dispatchRpc(target, method, params, albumLedger(), new CallRegistry(), new StickerRegistry());
}

describe('chat-list RPC writes', () => {
  it('moves a chat between folder 0 and folder 1', async () => {
    const { client, call } = stubClient();
    await expect(dispatch(client, 'setArchived', { chatId: 7, archived: true })).resolves.toEqual({ chatId: 7, archived: true });
    expect(call).toHaveBeenCalledWith({
      _: 'folders.editPeerFolders',
      folderPeers: [{ _: 'inputFolderPeer', peer: { _: 'inputPeerUser', userId: 7, accessHash: 1n }, folderId: 1 }],
    });
    await dispatch(client, 'setArchived', { chatId: 7, archived: false });
    expect(call.mock.calls[1]?.[0]).toMatchObject({ folderPeers: [{ folderId: 0 }] });
  });

  it('sets a pin rather than toggling it, so a retry is idempotent', async () => {
    const { client, call } = stubClient();
    await expect(dispatch(client, 'setPinned', { chatId: 7, pinned: true })).resolves.toEqual({ chatId: 7, pinned: true });
    expect(call).toHaveBeenCalledWith({
      _: 'messages.toggleDialogPin',
      pinned: true,
      peer: { _: 'inputDialogPeer', peer: { _: 'inputPeerUser', userId: 7, accessHash: 1n } },
    });
  });

  it('refuses a malformed flag before Telegram sees it', async () => {
    const { client, call } = stubClient();
    await expect(dispatch(client, 'setArchived', { chatId: 7, archived: 'yes' })).rejects.toMatchObject({
      status: 400,
    } satisfies Partial<EngineError>);
    await expect(dispatch(client, 'setPinned', { chatId: 7 })).rejects.toMatchObject({ status: 400 } satisfies Partial<EngineError>);
    expect(call).not.toHaveBeenCalled();
  });
});
