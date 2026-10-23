import type { TelegramClient } from '@mtcute/core/client.js';
import { Long } from '@mtcute/core';
import type { Dialog, Message } from '@mtcute/core';
import type { RpcBatchOutcome } from '../rpc-types';
import type { DialogDto, PresenceDto } from '../types';
import { setChatArchived } from './archive';
import { readBotCommands } from './bot-commands';
import { readComments, requireCommentPost, requireDiscussion } from './comments';
import { toDialogDto, toMeDto, toMessageDto, toPollDto } from './dto';
import { EngineError, isStorageWriteQuotaError, STORAGE_WRITE_QUOTA_MESSAGE } from './errors';
import { readContactPresences } from './presence';
import { readProfile } from './profile';
import { albumAwareUnread, reconcileUnreadAlbums } from './unread-albums';
import type { UnreadAlbumLedger } from './unread-albums';
import {
  clampInt,
  optionalAnswerIndexes,
  optionalBoolean,
  optionalInt,
  optionalMessageId,
  optionalRandomId,
  optionalText,
  parseBatchCalls,
  requireBoolean,
  requireMessageId,
  requireMessageIds,
  requireCallbackData,
  requirePeerId,
  requireQuery,
  requireRecord,
  requireText,
} from './params';
import { peerIdsIn, withPeerRetry } from './peers';

/**
 * The curated method surface of `POST /user/rpc`.
 *
 * Deliberately a whitelist — the bridge never forwards raw MTProto from the
 * browser. Every method resolves peers server-side (marked ids in, DTOs out).
 *
 * The album ledger is the engine's answer to Telegram counting every album
 * member as a message: the badge counts an album once, and the ledger knows
 * the surplus to subtract from the chat list's counts.
 */
export async function dispatchRpc(client: TelegramClient, method: string, rawParams: unknown, albums: UnreadAlbumLedger): Promise<unknown> {
  const params = requireRecord(rawParams);
  switch (method) {
    case 'batch': {
      const calls = parseBatchCalls(params.calls);
      // The calls run concurrently over the one Telegram connection: a batch
      // is the only way to overlap them, because the Durable Object hands out
      // one event at a time and separate requests would queue behind each
      // other instead.
      const results = await Promise.all(
        calls.map(async (call) => {
          try {
            // The per-call wrapper is what retries a call whose peer Telegram
            // rejected; a batch reports failures per call, so the retry cannot
            // live above it.
            const result = await withPeerRetry(client, peerIdsIn(call.params), () => dispatchRpc(client, call.method, call.params, albums));
            return { ok: true, result } satisfies RpcBatchOutcome;
          } catch (error) {
            // A failed call is reported on its own: one broken read must not
            // take the reads beside it down with it.
            return { ok: false, error: failureText(error) } satisfies RpcBatchOutcome;
          }
        }),
      );
      return { results };
    }

    case 'getMe': {
      return { me: toMeDto(await client.getMe()) };
    }

    case 'getDialogs': {
      const limit = clampInt(params.limit, 1, 200, 100);
      // The archive is its own peer folder, so it is its own read: one limit
      // over both would cost the main list the chats the archive holds.
      const archived = optionalBoolean(params.archived, 'archived') === true;
      // The chat list and the contact presences are two independent Telegram
      // reads; running them together saves a round trip on every list load.
      const [dialogs, presences] = await Promise.all([collectDialogs(client, limit, albums, archived), readContactPresences(client)]);
      return { dialogs: overlayPresence(dialogs, presences) };
    }

    case 'getHistory': {
      const chatId = requirePeerId(params.chatId);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offsetId = optionalInt(params.offsetId);
      const offsetDate = optionalInt(params.offsetDate);
      // Only the newer direction is meaningful: the bridge has no forward
      // paging, so a positive skip would hide the messages next to a jump.
      const addOffset = clampInt(params.addOffset, -50, 0, 0);
      const anchorId = optionalInt(params.anchorId);
      const page = await readWindow(client, chatId, { limit, offsetId, offsetDate, addOffset, anchorId });
      const messages = await completeOldestAlbum(client, chatId, page);
      // mtcute answers newest-first; the bridge promises oldest-first.
      return { messages: messages.map(toMessageDto).toReversed() };
    }

    case 'sendMessage': {
      const chatId = requirePeerId(params.chatId);
      const text = requireText(params.text);
      const replyTo = optionalMessageId(params.replyTo);
      const randomId = optionalRandomId(params.randomId);
      return {
        message: toMessageDto(
          await client.sendText(chatId, text, {
            ...(replyTo !== undefined && { replyTo }),
            ...(randomId !== undefined && { randomId }),
          }),
        ),
      };
    }

    case 'forwardMessages': {
      const chatId = requirePeerId(params.chatId);
      const toChatId = requirePeerId(params.toChatId);
      const messageIds = requireMessageIds(params.messageIds);
      const forwarded = await client.forwardMessagesById({
        fromChatId: chatId,
        toChatId,
        messages: messageIds,
      });
      return { messages: forwarded.map(toMessageDto) };
    }

    case 'readHistory': {
      const chatId = requirePeerId(params.chatId);
      const maxId = optionalInt(params.maxId);
      if (maxId === undefined || maxId === 0) {
        await client.readHistory(chatId);
      } else {
        await client.readHistory(chatId, { maxId });
      }
      return {};
    }

    case 'searchMessages': {
      const chatId = requirePeerId(params.chatId);
      const query = requireQuery(params.query);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offset = optionalInt(params.offsetId);
      const found = await client.searchMessages({
        chatId,
        query,
        limit,
        ...(offset !== undefined && { offset }),
      });
      return { messages: found.map(toMessageDto), nextOffsetId: found.next };
    }

    case 'sendReaction': {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const emoji = optionalText(params.emoji, 32, 'emoji');
      const customEmojiId = optionalText(params.customEmojiId, 32, 'customEmojiId');
      if (emoji !== undefined && customEmojiId !== undefined) {
        throw new EngineError('Provide emoji or customEmojiId, not both', 400);
      }
      let reaction: string | Long | null = emoji ?? null;
      if (customEmojiId !== undefined) {
        if (!/^\d+$/.test(customEmojiId)) {
          throw new EngineError('customEmojiId must be a decimal document id', 400);
        }
        reaction = Long.fromString(customEmojiId);
      }
      const message = await client.sendReaction({ chatId, message: messageId, emoji: reaction });
      return { message: message ? toMessageDto(message) : null };
    }

    case 'sendVote': {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const options = optionalAnswerIndexes(params.options);
      const poll = await client.sendVote({ chatId, message: messageId, options });
      return { poll: toPollDto(poll) };
    }

    case 'pressCallbackButton': {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const data = requireCallbackData(params.data);
      const answer = await client.getCallbackAnswer({ chatId, message: messageId, data });
      return {
        text: answer.message ?? null,
        alert: answer.alert === true,
        url: answer.url ?? null,
      };
    }

    case 'getPollResults': {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const poll = await client.getPollResults({ chatId, message: messageId });
      return { poll: toPollDto(poll) };
    }

    case 'getComments': {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offsetId = optionalInt(params.offsetId);
      const offsetDate = optionalInt(params.offsetDate);
      const { discussion, page } = await readComments(client, {
        chatId,
        messageId,
        limit,
        ...(offsetId !== undefined && { offsetId }),
        ...(offsetDate !== undefined && { offsetDate }),
      });
      return {
        comments: page.comments.map(toMessageDto),
        count: page.count,
        discussionChatId: discussion?.chatId ?? null,
        discussionMessageId: discussion?.rootId ?? null,
        ...(page.nextOffset && { nextOffsetId: page.nextOffset.id, nextOffsetDate: page.nextOffset.date }),
      };
    }

    case 'sendComment': {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const text = requireText(params.text);
      const replyTo = optionalMessageId(params.replyTo);
      const randomId = optionalRandomId(params.randomId);
      const post = await requireCommentPost(client, chatId, messageId);
      if (replyTo === undefined) {
        // `commentText` resolves the thread itself and covers the
        // first-comment case Telegram accepts through the channel.
        return {
          message: toMessageDto(await client.commentText(post, text, { ...(randomId !== undefined && { randomId }) })),
        };
      }
      const discussion = await requireDiscussion(client, chatId, messageId);
      return {
        message: toMessageDto(
          await client.sendText(discussion.peer, text, {
            replyTo,
            ...(randomId !== undefined && { randomId }),
          }),
        ),
      };
    }

    case 'getBotCommands': {
      const chatId = requirePeerId(params.chatId);
      return { commands: await readBotCommands(client, chatId) };
    }

    case 'setArchived': {
      const chatId = requirePeerId(params.chatId);
      const archived = requireBoolean(params.archived, 'archived');
      await setChatArchived(client, chatId, archived);
      return { chatId, archived };
    }

    case 'getProfile': {
      const chatId = requirePeerId(params.chatId);
      return { profile: await readProfile(client, chatId) };
    }

    default: {
      throw new EngineError(`Unknown RPC method: ${method}`, 404);
    }
  }
}

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
async function collectDialogs(client: TelegramClient, limit: number, albums: UnreadAlbumLedger, archived: boolean): Promise<DialogDto[]> {
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

/**
How many messages of context a jump window reads on the newer side of the
linked post; the rest of the page is the post and its older messages.
*/
const JUMP_CONTEXT = 25;

interface WindowRequest {
  limit: number;
  offsetId?: number;
  offsetDate?: number;
  addOffset: number;
  /**
   * The message the window has to hold, when the reader jumped to one.
   */
  anchorId?: number;
}

/**
 * Reads one window of a chat.
 *
 * With an anchor, the window is read *around* that message: the post lands
 * mid-page with its newer context beside it. When the first read missed it —
 * a deleted post, or one past the end of the history — the page that ends at
 * it is read instead, which still lands the reader right next to it. That
 * fallback used to cost the SPA a second round trip.
 */
async function readWindow(client: TelegramClient, chatId: number, request: WindowRequest): Promise<Message[]> {
  if (request.anchorId !== undefined) {
    const skip = request.addOffset === 0 ? -JUMP_CONTEXT : request.addOffset;
    const around = await client.getHistory(chatId, {
      limit: request.limit,
      offset: { id: request.anchorId, date: 0 },
      addOffset: skip,
    });
    if (around.some((message) => message.id === request.anchorId)) return around;
    return client.getHistory(chatId, { limit: request.limit, offset: { id: request.anchorId + 1, date: 0 } });
  }
  return client.getHistory(chatId, {
    limit: request.limit,
    ...(request.offsetId !== undefined && { offset: { id: request.offsetId, date: request.offsetDate ?? 0 } }),
    ...(request.addOffset !== 0 && { addOffset: request.addOffset }),
  });
}

/**
 * The message a failed call reports.
 */
function failureText(error: unknown): string {
  if (error instanceof EngineError) return error.message;
  if (isStorageWriteQuotaError(error)) return STORAGE_WRITE_QUOTA_MESSAGE;
  return error instanceof Error ? error.message : String(error);
}

/**
Completes the oldest album of a history window.

mtcute answers a page newest-first, so its oldest message can sit in the middle
of an album whose older members were not in the page. An album caps at ten
messages, so one extra fetch of nine settles the window's top edge and the SPA
never renders a partial grid there.
*/
async function completeOldestAlbum(client: TelegramClient, chatId: number, page: readonly Message[]): Promise<Message[]> {
  const messages = [...page];
  let oldest: Message | undefined;
  for (const message of page) {
    if (!oldest || message.id < oldest.id) oldest = message;
  }
  const groupedId = oldest?.groupedId?.toString();
  if (!oldest || groupedId === undefined) return messages;
  const older = await client.getHistory(chatId, {
    limit: 9,
    offset: { id: oldest.id, date: Math.floor(oldest.date.getTime() / 1000) },
  });
  for (const message of older) {
    if (message.groupedId?.toString() !== groupedId) break;
    messages.push(message);
  }
  return messages;
}
