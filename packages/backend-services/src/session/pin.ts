import type { TelegramClient } from '@mtcute/core/client.js';

/**
The account's pinned chats.

Telegram pins a dialog inside its peer folder: the chat list and the archive
each have their own pinned block. `messages.toggleDialogPin` is the API the
official clients use for it, and the `pinned` flag makes it a set rather than
a toggle, so a retried call does not undo the first one.
*/
export async function setChatPinned(client: TelegramClient, chatId: number, pinned: boolean): Promise<void> {
  const peer = await client.resolvePeer(chatId);
  await client.call({
    _: 'messages.toggleDialogPin',
    pinned,
    peer: { _: 'inputDialogPeer', peer },
  });
}
