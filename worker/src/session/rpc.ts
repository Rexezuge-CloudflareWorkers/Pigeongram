import type { TelegramClient } from '@mtcute/core/client.js';
import { Long } from '@mtcute/core';
import type { Message } from '@mtcute/core';
import type { DialogDto, PresenceDto } from '../types';
import { readBotCommands } from './bot-commands';
import { readComments, requireCommentPost, requireDiscussion } from './comments';
import { toDialogDto, toMeDto, toMessageDto, toPollDto } from './dto';
import { EngineError } from './errors';
import { readContactPresences } from './presence';
import {
  clampInt,
  optionalAnswerIndexes,
  optionalInt,
  optionalMessageId,
  optionalRandomId,
  optionalText,
  requireMessageId,
  requireMessageIds,
  requireCallbackData,
  requirePeerId,
  requireQuery,
  requireRecord,
  requireText,
} from './params';

/**
 * The curated method surface of `POST /user/rpc`.
 *
 * Deliberately a whitelist — the bridge never forwards raw MTProto from the
 * browser. Every method resolves peers server-side (marked ids in, DTOs out).
 */
export async function dispatchRpc(client: TelegramClient, method: string, rawParams: unknown): Promise<unknown> {
  const params = requireRecord(rawParams);
  switch (method) {
    case 'getMe': {
      return { me: toMeDto(await client.getMe()) };
    }

    case 'getDialogs': {
      const limit = clampInt(params.limit, 1, 200, 100);
      const dialogs: DialogDto[] = [];
      for await (const dialog of client.iterDialogs({ limit })) {
        dialogs.push(toDialogDto(dialog));
      }
      return { dialogs: overlayPresence(dialogs, await readContactPresences(client)) };
    }

    case 'getHistory': {
      const chatId = requirePeerId(params.chatId);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offsetId = optionalInt(params.offsetId);
      const offsetDate = optionalInt(params.offsetDate);
      // Only the newer direction is meaningful: the bridge has no forward
      // paging, so a positive skip would hide the messages next to a jump.
      const addOffset = clampInt(params.addOffset, -50, 0, 0);
      const page = await client.getHistory(chatId, {
        limit,
        ...(offsetId !== undefined && { offset: { id: offsetId, date: offsetDate ?? 0 } }),
        ...(addOffset !== 0 && { addOffset }),
      });
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
