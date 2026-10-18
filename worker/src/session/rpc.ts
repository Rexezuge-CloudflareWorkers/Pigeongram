import type { TelegramClient } from '@mtcute/core/client.js';
import { Long } from '@mtcute/core';
import type { DialogDto, MessageDto } from '../types';
import { readComments, requireCommentPost, requireDiscussion } from './comments';
import { toDialogDto, toMeDto, toMessageDto } from './dto';
import { EngineError } from './errors';
import {
  clampInt,
  optionalInt,
  optionalMessageId,
  optionalText,
  requireMessageId,
  requirePeerId,
  requireQuery,
  requireRecord,
  requireText,
} from './params';

/**
 * The curated method surface of `POST /api/rpc`.
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
      return { dialogs };
    }

    case 'getHistory': {
      const chatId = requirePeerId(params.chatId);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offsetId = optionalInt(params.offsetId);
      const offsetDate = optionalInt(params.offsetDate);
      const messages: MessageDto[] = (
        await client.getHistory(
          chatId,
          offsetId !== undefined && offsetDate !== undefined ? { limit, offset: { id: offsetId, date: offsetDate } } : { limit },
        )
      ).map(toMessageDto);
      return { messages };
    }

    case 'sendMessage': {
      const chatId = requirePeerId(params.chatId);
      const text = requireText(params.text);
      const replyTo = optionalMessageId(params.replyTo);
      return { message: toMessageDto(await client.sendText(chatId, text, { ...(replyTo !== undefined && { replyTo }) })) };
    }

    case 'readHistory': {
      const chatId = requirePeerId(params.chatId);
      await client.readHistory(chatId);
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
      const post = await requireCommentPost(client, chatId, messageId);
      if (replyTo === undefined) {
        // `commentText` resolves the thread itself and covers the
        // first-comment case Telegram accepts through the channel.
        return { message: toMessageDto(await client.commentText(post, text)) };
      }
      const discussion = await requireDiscussion(client, chatId, messageId);
      return { message: toMessageDto(await client.sendText(discussion.peer, text, { replyTo })) };
    }

    default: {
      throw new EngineError(`Unknown RPC method: ${method}`, 404);
    }
  }
}
