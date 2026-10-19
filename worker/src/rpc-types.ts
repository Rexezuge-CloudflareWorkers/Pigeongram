/**
 * The RPC half of the JSON contract: the method names exposed over
 * `POST /api/rpc` with their parameters and results. Split from `types.ts`
 * (which keeps the DTOs they carry) so each contract module stays under the
 * god-file cap; the SPA mirrors both in `pages/src/types.ts`.
 */

import type { DialogDto, MeDto, MessageDto, MessagePollDto, PeerId } from './types';

export interface RpcRequestDto {
  method: string;
  params?: Record<string, unknown>;
}

/**
Methods exposed over `POST /api/rpc`.
*/
export type RpcMethod =
  | 'getMe'
  | 'getDialogs'
  | 'getHistory'
  | 'sendMessage'
  | 'readHistory'
  | 'searchMessages'
  | 'sendReaction'
  | 'sendVote'
  | 'getPollResults'
  | 'getComments'
  | 'sendComment';

export interface GetDialogsParams {
  limit?: number;
}

export interface GetHistoryParams {
  chatId: PeerId;
  limit?: number;
  /**
   * Pagination cursor: return messages older than this message. Both fields
   * come from the oldest loaded message; the UI de-duplicates by id anyway.
   */
  offsetId?: number;
  offsetDate?: number;
}

export interface SendMessageParams {
  chatId: PeerId;
  text: string;
  /**
   * Id of the message to reply to, in the same chat.
   */
  replyTo?: number;
}

export interface ReadHistoryParams {
  chatId: PeerId;
  /**
  Read only up to this message id; omitted reads the whole history. The SPA
  passes what the user actually scrolled through.
  */
  maxId?: number;
}

export interface SearchMessagesParams {
  chatId: PeerId;
  query: string;
  limit?: number;
}

export interface SendReactionParams {
  chatId: PeerId;
  messageId: number;
  /**
   * Unicode emoji to set, e.g. `👍`. Mutually exclusive with `customEmojiId`.
   */
  emoji?: string | null;
  /**
   * Decimal document id of a custom emoji to set.
   */
  customEmojiId?: string | null;
}

export interface SendVoteParams {
  chatId: PeerId;
  messageId: number;
  /**
  Indexes of the selected answers, in the order the message carries them;
  `null`/omitted retracts the current vote. Telegram caps a poll at ten
  answers, which is also what the bridge accepts.
  */
  options?: number[] | null;
}

export interface GetPollResultsParams {
  chatId: PeerId;
  messageId: number;
}

export interface GetCommentsParams {
  /**
   * The channel the post belongs to.
   */
  chatId: PeerId;
  /**
   * Id of the channel post whose thread is being read.
   */
  messageId: number;
  limit?: number;
  /**
   * Pagination cursor for older comments: the oldest loaded comment's id and
   * unix-seconds date. Both come together or not at all.
   */
  offsetId?: number;
  offsetDate?: number;
}

export interface SendCommentParams {
  /**
   * The channel the post belongs to.
   */
  chatId: PeerId;
  /**
   * Id of the channel post being commented on.
   */
  messageId: number;
  text: string;
  /**
   * Id of the comment being replied to inside the thread; omitted for a
   * top-level comment.
   */
  replyTo?: number;
}

export interface GetMeResult {
  me: MeDto;
}

export interface GetDialogsResult {
  dialogs: DialogDto[];
}

export interface GetHistoryResult {
  messages: MessageDto[];
}

export interface SendMessageResult {
  message: MessageDto;
}

export interface SendReactionResult {
  /**
   * The reacted message, when Telegram returned it; `null` otherwise.
   */
  message: MessageDto | null;
}

export interface SearchMessagesResult {
  messages: MessageDto[];
  nextOffsetId?: number;
}

export interface SendVoteResult {
  /**
  The poll as Telegram answered the vote: the caller's selection plus the
  counts that were visible to this account.
  */
  poll: MessagePollDto;
}

export interface GetPollResultsResult {
  poll: MessagePollDto;
}

export interface GetCommentsResult {
  /**
   * Comments of one thread window, oldest first.
   */
  comments: MessageDto[];
  /**
   * Total number of comments in the thread.
   */
  count: number;
  /**
   * Marked id of the linked discussion group; null when the thread does not
   * exist yet (no comment was ever posted).
   */
  discussionChatId: PeerId | null;
  /**
   * Id of the thread's root message in the discussion group; null when the
   * thread does not exist yet.
   */
  discussionMessageId: number | null;
  /**
   * Pagination cursor for older comments; absent when the oldest comment is
   * loaded.
   */
  nextOffsetId?: number;
  nextOffsetDate?: number;
}

export interface SendCommentResult {
  message: MessageDto;
}
