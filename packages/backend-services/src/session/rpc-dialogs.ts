import type { TelegramClient } from '@mtcute/core/client.js';
import type { Dialog } from '@mtcute/core';
import type { DialogDto, PresenceDto } from '../types';
import { readBotCommands } from './bot-commands';
import { setChatArchived } from './archive';
import { resolveDiscussion } from './comments';
import { toDialogDto, toMeDto } from './dto';
import { clampInt, optionalBoolean, optionalMessageId, requireBoolean, requirePeerId } from './params';
import { readContactPresences } from './presence';
import { readProfile } from './profile';
import { albumAwareUnread, reconcileUnreadAlbums } from './unread-albums';
import type { PartialMethodTable } from './rpc-methods';

/**
 * The chat-list half of the bridge: who the account is, which chats it has,
 * the archive move, and the per-chat reads that are not message windows.
 *
 * Every method here is a read except `setArchived`, which is the one write the
 * chat list itself can make. The album ledger is consulted wherever a count is
 * served, so the badge and the list agree on what an album is worth.
 */
export const dialogsRpcMethods = {
  getMe: {
    readOnly: true,
    run: async (context) => ({ me: toMeDto(await context.client.getMe()) }),
  },

  getDialogs: {
    readOnly: true,
    run: async (context, params) => {
      const limit = clampInt(params.limit, 1, 200, 100);
      // The archive is its own peer folder, so it is its own read: one limit
      // over both would cost the main list the chats the archive holds.
      const archived = optionalBoolean(params.archived, 'archived') === true;
      // The chat list and the contact presences are two independent Telegram
      // reads; running them together saves a round trip on every list load.
      const [dialogs, presences] = await Promise.all([
        collectDialogs(context.client, limit, context.albums, archived),
        readContactPresences(context.client),
      ]);
      return { dialogs: overlayPresence(dialogs, presences) };
    },
  },

  setArchived: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const archived = requireBoolean(params.archived, 'archived');
      await setChatArchived(context.client, chatId, archived);
      return { chatId, archived };
    },
  },

  getBotCommands: {
    readOnly: true,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messageId = optionalMessageId(params.messageId);
      if (messageId === undefined) {
        return { commands: await readBotCommands(context.client, chatId) };
      }
      // A channel post's comments live in the linked discussion group, and its
      // composer offers that group's commands. The peer is resolved here, not
      // in the SPA; a post without a thread yet has no menu.
      const discussion = await resolveDiscussion(context.client, chatId, messageId);
      if (!discussion) return { commands: [] };
      return { commands: await readBotCommands(context.client, discussion.chatId, discussion.peer) };
    },
  },

  getProfile: {
    readOnly: true,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      return { profile: await readProfile(context.client, chatId) };
    },
  },
} as const satisfies PartialMethodTable;

/**
 * Overlays the account's contact presences onto the chat list.
 *
 * Telegram attaches a state to the user objects it sends only when it knows
 * one, so the contact list — which is the authoritative answer for the people
 * in it — wins over whatever the dialog carried.
 */
function overlayPresence(dialogs: DialogDto[], contacts: ReadonlyMap<number, PresenceDto>): DialogDto[] {
  if (contacts.size === 0) return dialogs;
  return dialogs.map((dialog) => {
    if (dialog.chat.kind !== 'user') return dialog;
    const presence = contacts.get(dialog.chat.id);
    if (!presence) return dialog;
    return { ...dialog, chat: { ...dialog.chat, presence } };
  });
}

/**
 * Reads the chat list, one Telegram page at a time.
 *
 * The album ledger is reconciled with the account's unread albums first, so
 * the counts the list carries are the ones the badge shows: an album counts
 * once, not once per file.
 */
async function collectDialogs(
  client: TelegramClient,
  limit: number,
  albums: Parameters<typeof reconcileUnreadAlbums>[2],
  archived: boolean,
): Promise<DialogDto[]> {
  const dialogs: Dialog[] = [];
  for await (const dialog of client.iterDialogs({ limit, archived: archived ? 'only' : 'exclude' })) {
    dialogs.push(dialog);
  }
  await reconcileUnreadAlbums(client, dialogs, albums);
  // The watermark the server reports is the truth about what has been read,
  // so the ledger drops the members below it. A read that landed while the
  // ledger was reconciling would otherwise leave its members behind, and the
  // surplus would be subtracted twice.
  const known = albums.excessByChat();
  const watermarks = new Map(dialogs.map((dialog) => [dialog.peer.id, dialog.lastReadIngoing]));
  for (const chatId of known.keys()) {
    const watermark = watermarks.get(chatId);
    if (watermark !== undefined) albums.pruneRead(chatId, watermark);
  }
  const excess = albums.excessByChat();
  return dialogs.map((dialog) => toDialogDto(dialog, albumAwareUnread(dialog.unreadCount ?? 0, excess.get(dialog.peer.id) ?? 0)));
}
