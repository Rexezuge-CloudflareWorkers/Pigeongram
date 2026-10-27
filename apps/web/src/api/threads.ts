import type {
  BotCommandDto,
  ForwardMessagesResult,
  GetBotCommandsResult,
  GetCommentsResult,
  GetHistoryResult,
  GetPollResultsResult,
  MessageDto,
  PeerId,
  PressCallbackButtonResult,
  RpcBatchCall,
  SendCommentResult,
  SendMessageResult,
  SendReactionResult,
  SendVoteResult,
} from '../types';
import { batchResult, rpc, rpcBatch } from './request';

/**
 * The thread half of the bridge: a chat's window and its slash commands, the
 * sends and edits beside them, and the comments screen of a channel post.
 */

/**
Everything a chat screen needs, read in one request.
*/
interface ChatScreen {
  /**
  The chat's first window.
  */
  messages: MessageDto[];
  /**
  The chat's slash commands, empty for a chat without one.
  */
  commands: BotCommandDto[];
  /**
  The post's comments, when a post was named. Null when the read failed —
  a post without a comments section is not a failure of the window beside it.
  */
  comments: GetCommentsResult | null;
  /**
  Why the comments could not be read, when they could not.
  */
  commentsError: string | null;
}

/**
 * Reads a chat screen: the window, the chat's slash commands and — when a
 * post is named — the post's comment thread.
 *
 * The reads are independent, so they travel together: one request, one
 * Durable Object event, and the Telegram calls inside it run at the same time
 * over the one connection.
 */
export async function fetchChatScreen(
  chatId: PeerId,
  postId: number | null = null,
  options: {
    limit?: number;
    offsetId?: number;
    addOffset?: number;
    anchorId?: number;
    withCommands?: boolean;
    commentsLimit?: number;
  } = {},
): Promise<ChatScreen> {
  const { withCommands = false, commentsLimit = 50, ...history } = options;
  const calls: RpcBatchCall[] = [{ method: 'getHistory', params: { chatId, ...history } }];
  if (withCommands) {
    calls.push({ method: 'getBotCommands', params: { chatId } });
  }
  if (postId !== null) {
    calls.push({ method: 'getComments', params: { chatId, messageId: postId, limit: commentsLimit } });
  }
  const outcomes = await rpcBatch(calls);
  const messages = batchResult<GetHistoryResult>(outcomes[0], 'chat history').messages;
  // A chat without a command menu is normal, and a failed lookup is no
  // worse than an empty one: the composer simply offers no menu.
  const commands = outcomes[1]?.ok ? (outcomes[1].result as GetBotCommandsResult).commands : [];
  const commentsOutcome = postId === null ? undefined : outcomes[2];
  return {
    messages,
    commands,
    comments: commentsOutcome?.ok ? (commentsOutcome.result as GetCommentsResult) : null,
    commentsError: commentsOutcome === undefined || commentsOutcome.ok ? null : (commentsOutcome.error ?? 'The comments could not be read'),
  };
}

export const fetchHistory = (
  chatId: PeerId,
  options: { limit?: number; offsetId?: number; offsetDate?: number; addOffset?: number; anchorId?: number } = {},
): Promise<GetHistoryResult> => rpc('getHistory', { chatId, ...options });

export const sendMessage = (chatId: PeerId, text: string, replyTo?: number, randomId?: string): Promise<SendMessageResult> =>
  rpc('sendMessage', {
    chatId,
    text,
    ...(replyTo !== undefined && { replyTo }),
    ...(randomId !== undefined && { randomId }),
  });

/**
Forwards messages from their source chat into another chat. An album sends
its members as one batch; the engine returns the copies in the destination.
*/
export const forwardMessages = (chatId: PeerId, messageIds: number[], toChatId: PeerId): Promise<ForwardMessagesResult> =>
  rpc('forwardMessages', { chatId, messageIds, toChatId });

export const readHistory = (chatId: PeerId, maxId?: number): Promise<unknown> =>
  rpc('readHistory', { chatId, ...(maxId !== undefined && { maxId }) });

export const fetchComments = (
  chatId: PeerId,
  messageId: number,
  options: { limit?: number; offsetId?: number; offsetDate?: number } = {},
): Promise<GetCommentsResult> => rpc('getComments', { chatId, messageId, ...options });

export const sendComment = (
  chatId: PeerId,
  messageId: number,
  text: string,
  replyTo?: number,
  randomId?: string,
): Promise<SendCommentResult> =>
  rpc('sendComment', {
    chatId,
    messageId,
    text,
    ...(replyTo !== undefined && { replyTo }),
    ...(randomId !== undefined && { randomId }),
  });

/**
Sets (or, with `null`, removes) the current user's reaction on a message.
Custom emoji reactions are addressed by their decimal document id.
*/
export const sendReaction = (
  chatId: PeerId,
  messageId: number,
  reaction: { emoji?: string } | { customEmojiId: string } | null,
): Promise<SendReactionResult> =>
  rpc('sendReaction', {
    chatId,
    messageId,
    emoji: reaction && 'emoji' in reaction ? reaction.emoji : null,
    customEmojiId: reaction && 'customEmojiId' in reaction ? reaction.customEmojiId : null,
  });

/**
Casts (or, with `null`, retracts) a vote in a poll: the indexes name answers in
the order the message carries them. The engine resolves the indexes against
the live poll, so a stale message can never send a wrong option's bytes.
*/
export const sendVote = (chatId: PeerId, messageId: number, options: number[] | null): Promise<SendVoteResult> =>
  rpc('sendVote', { chatId, messageId, options });

/**
Presses an inline callback button. The payload is the base64 string the
message's button carried; the bridge decodes it and forwards it unchanged.
*/
export const pressCallbackButton = (chatId: PeerId, messageId: number, data: string): Promise<PressCallbackButtonResult> =>
  rpc('pressCallbackButton', { chatId, messageId, data });

/**
Re-reads a poll the bridge could only announce (a short update): the answer is
the same DTO `sendVote` returns, so the caller folds it in the same way.
*/
export const fetchPollResults = (chatId: PeerId, messageId: number): Promise<GetPollResultsResult> =>
  rpc('getPollResults', { chatId, messageId });
