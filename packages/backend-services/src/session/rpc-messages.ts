import type { TelegramClient } from '@mtcute/core/client.js';
import { Long } from '@mtcute/core';
import type { Message } from '@mtcute/core';
import { readComments, requireCommentPost, requireDiscussion, resolveDiscussion } from './comments';
import { toMessageDto, toPollDto } from './dto';
import { EngineError } from './errors';
import {
  clampInt,
  optionalAnswerIndexes,
  optionalInt,
  optionalMessageId,
  optionalRandomId,
  optionalText,
  requireCallbackData,
  requireMessageId,
  requireMessageIds,
  requirePeerId,
  requireText,
} from './params';
import { resolveReplyPreviews } from './reply-previews';
import type { PartialMethodTable } from './rpc-methods';

/**
 * The message half of the bridge: history windows, sends, forwards, reads,
 * reactions, votes, callback buttons and comment threads.
 *
 * The window helpers live here because they are the read path's rules: an
 * anchored jump lands the post mid-page, and the oldest album of a window is
 * completed so its grid never renders a partial row at the top edge.
 */
export const messagesRpcMethods = {
  getHistory: {
    readOnly: true,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offsetId = optionalInt(params.offsetId);
      const offsetDate = optionalInt(params.offsetDate);
      // Only the newer direction is meaningful: the bridge has no forward
      // paging, so a positive skip would hide the messages next to a jump.
      const addOffset = clampInt(params.addOffset, -50, 0, 0);
      const anchorId = optionalInt(params.anchorId);
      const page = await readWindow(context.client, chatId, { limit, offsetId, offsetDate, addOffset, anchorId });
      const messages = await completeOldestAlbum(context.client, chatId, page);
      // Quotes complete on the first paint: the originals a page names but does
      // not contain are read here, inside the same event.
      const withPreviews = await resolveReplyPreviews(context.client, messages.map(toMessageDto));
      // mtcute answers newest-first; the bridge promises oldest-first.
      return { messages: withPreviews.toReversed() };
    },
  },

  sendMessage: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const text = requireText(params.text);
      const replyTo = optionalMessageId(params.replyTo);
      const randomId = optionalRandomId(params.randomId);
      return {
        message: toMessageDto(
          await context.client.sendText(chatId, text, {
            ...(replyTo !== undefined && { replyTo }),
            ...(randomId !== undefined && { randomId }),
          }),
        ),
      };
    },
  },

  forwardMessages: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const toChatId = requirePeerId(params.toChatId);
      const messageIds = requireMessageIds(params.messageIds);
      const forwarded = await context.client.forwardMessagesById({
        fromChatId: chatId,
        toChatId,
        messages: messageIds,
      });
      return { messages: forwarded.map(toMessageDto) };
    },
  },

  readHistory: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const maxId = optionalInt(params.maxId);
      if (maxId === undefined || maxId === 0) {
        await context.client.readHistory(chatId);
      } else {
        await context.client.readHistory(chatId, { maxId });
      }
      return {};
    },
  },

  sendReaction: {
    readOnly: false,
    run: async (context, params) => {
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
      const message = await context.client.sendReaction({ chatId, message: messageId, emoji: reaction });
      return { message: message ? toMessageDto(message) : null };
    },
  },

  sendVote: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const options = optionalAnswerIndexes(params.options);
      const poll = await context.client.sendVote({ chatId, message: messageId, options });
      return { poll: toPollDto(poll) };
    },
  },

  pressCallbackButton: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const data = requireCallbackData(params.data);
      const answer = await context.client.getCallbackAnswer({ chatId, message: messageId, data });
      return {
        text: answer.message ?? null,
        alert: answer.alert === true,
        url: answer.url ?? null,
      };
    },
  },

  getPollResults: {
    readOnly: true,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const poll = await context.client.getPollResults({ chatId, message: messageId });
      return { poll: toPollDto(poll) };
    },
  },

  getComments: {
    readOnly: true,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offsetId = optionalInt(params.offsetId);
      const offsetDate = optionalInt(params.offsetDate);
      const { discussion, page, commands } = await readComments(context.client, {
        chatId,
        messageId,
        limit,
        ...(offsetId !== undefined && { offsetId }),
        ...(offsetDate !== undefined && { offsetDate }),
      });
      return {
        // Top-level comments reply to the thread root, whose quote is hidden;
        // passing it as ignored keeps the resolution from reading it on every
        // page of an ordinary thread.
        comments: await resolveReplyPreviews(
          context.client,
          page.comments.map(toMessageDto),
          discussion === null ? undefined : new Set([discussion.rootId]),
        ),
        count: page.count,
        discussionChatId: discussion?.chatId ?? null,
        discussionMessageId: discussion?.rootId ?? null,
        commands,
        ...(page.nextOffset && { nextOffsetId: page.nextOffset.id, nextOffsetDate: page.nextOffset.date }),
      };
    },
  },

  sendComment: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messageId = requireMessageId(params.messageId);
      const text = requireText(params.text);
      const replyTo = optionalMessageId(params.replyTo);
      const randomId = optionalRandomId(params.randomId);
      const post = await requireCommentPost(context.client, chatId, messageId);
      if (replyTo === undefined) {
        // A top-level comment replies to the thread root. mtcute's
        // `commentText` resolves that root itself but takes the first message
        // of the thread-start window, which is a comment (or an album member)
        // once the window carries more than the root; resolve it here instead.
        // Without a thread yet, `commentText` covers the first comment
        // Telegram accepts through the channel.
        const discussion = await resolveDiscussion(context.client, chatId, messageId);
        const message =
          discussion === null
            ? await context.client.commentText(post, text, { ...(randomId !== undefined && { randomId }) })
            : await context.client.sendText(discussion.peer, text, {
                replyTo: discussion.rootId,
                ...(randomId !== undefined && { randomId }),
              });
        return { message: toMessageDto(message) };
      }
      const discussion = await requireDiscussion(context.client, chatId, messageId);
      return {
        message: toMessageDto(
          await context.client.sendText(discussion.peer, text, {
            replyTo,
            ...(randomId !== undefined && { randomId }),
          }),
        ),
      };
    },
  },
} as const satisfies PartialMethodTable;

/**
How many messages of context a jump window reads on the newer side of the
linked post, at most: the rest of the page is the post and its older messages.
Half a page lands the post mid-window; the cap keeps a larger read from
spending more than twenty-five messages of context.
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
    const skip = request.addOffset === 0 ? -Math.min(JUMP_CONTEXT, Math.floor(request.limit / 2)) : request.addOffset;
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
