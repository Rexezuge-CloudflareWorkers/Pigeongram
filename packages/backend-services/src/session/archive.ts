import type { TelegramClient } from '@mtcute/core/client.js';

/**
The account's archive.

Telegram keeps the archive in the peer folder with the id 1; every other chat
is in folder 0. `folders.editPeerFolders` is the API the official clients use
for it — it adds and removes peers from a peer folder — so archiving a chat
here is the same move Telegram's own clients make.
*/
export const ARCHIVE_FOLDER_ID = 1;

/**
Moves a chat into the archive, or back out of it.

The peer is resolved server-side, so the browser only ever names a marked peer
id. Telegram answers with the update that carries the new folder of the moved
peer; the bridge does not need it — the caller knows the state it asked for.
*/
export async function setChatArchived(client: TelegramClient, chatId: number, archived: boolean): Promise<void> {
  const peer = await client.resolvePeer(chatId);
  await client.call({
    _: 'folders.editPeerFolders',
    folderPeers: [{ _: 'inputFolderPeer', peer, folderId: archived ? ARCHIVE_FOLDER_ID : 0 }],
  });
}
