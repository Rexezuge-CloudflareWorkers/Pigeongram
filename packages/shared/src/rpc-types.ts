/**
 * The RPC half of the JSON contract: the method names exposed over
 * `POST /user/rpc` with their parameters and results. Split from `types.ts`
 * (which keeps the DTOs they carry) so each contract module stays under the
 * god-file cap; the SPA mirrors both in `apps/web/src/types.ts`.
 */

import type { BotCommandDto, DialogDto, MeDto, MessageDto, MessagePollDto, PeerId, ProfileDto } from './types';

export interface RpcRequestDto {
  method: string;
  params?: Record<string, unknown>;
}

/**
Methods exposed over `POST /user/rpc`.
*/
export type RpcMethod =
  | 'getMe'
  | 'getDialogs'
  | 'getHistory'
  | 'sendMessage'
  | 'forwardMessages'
  | 'readHistory'
  | 'searchMessages'
  | 'sendReaction'
  | 'sendVote'
  | 'pressCallbackButton'
  | 'getPollResults'
  | 'getComments'
  | 'sendComment'
  | 'getBotCommands'
  | 'setArchived'
  | 'getProfile'
  | 'getCallDhConfig'
  | 'requestCall'
  | 'receivedCall'
  | 'acceptCall'
  | 'confirmCall'
  | 'discardCall'
  | 'rateCall'
  // The meta-method: several reads in one request.
  | 'batch';

/**
The methods a `batch` call may carry.

Deliberately the read-only half of {@link RpcMethod}: a batch runs its calls
concurrently, so a write in it would have no defined completion order, and
Telegram's own ordering guarantees matter more than the round trip saved.
`readHistory` is excluded for the same reason it stays a single call — it
mutates the account's read watermark. `setArchived` is excluded because it
moves a chat between the chat list and the archive.
*/
export type BatchableRpcMethod =
  'getMe' | 'getDialogs' | 'getHistory' | 'searchMessages' | 'getPollResults' | 'getComments' | 'getBotCommands' | 'getProfile';

/**
One call inside a `batch`.
*/
export interface RpcBatchCall {
  method: BatchableRpcMethod;
  params?: Record<string, unknown>;
}

/**
The outcome of one call inside a `batch`.

A failed call is reported on its own, so one broken read (a post without a
comments section) never takes the reads beside it down with it.
*/
export interface RpcBatchOutcome {
  ok: boolean;
  /**
  The call's result, when it succeeded.
  */
  result?: unknown;
  /**
  The failure's message, when it failed.
  */
  error?: string;
}

export interface GetDialogsParams {
  limit?: number;
  /**
   * Reads the archive instead of the chat list: `true` returns the chats in
   * Telegram's archive (the peer folder 1), `false` (the default) the main
   * list. The two are separate reads — one limit would otherwise cost the
   * main list the chats the archive holds.
   */
  archived?: boolean;
}

/**
Moves a chat into the archive, or back out of it.
*/
export interface SetArchivedParams {
  chatId: PeerId;
  /**
   * `true` archives the chat, `false` brings it back into the main list.
   */
  archived: boolean;
}

export interface GetHistoryParams {
  chatId: PeerId;
  limit?: number;
  /**
   * Pagination cursor: return messages older than this message. `offsetDate`
   * comes along from the oldest loaded message; a link jump knows only the
   * post's id, and an omitted date reads as 0. The UI de-duplicates by id
   * anyway.
   */
  offsetId?: number;
  offsetDate?: number;
  /**
   * Skips `addOffset` messages from `offsetId` before reading (negative is
   * towards newer messages), so a linked post can land mid-page: the SPA asks
   * for a page around it instead of everything older than it.
   */
  addOffset?: number;
  /**
   * The message the window has to hold: a linked post the reader jumped to.
   * The engine reads around it and, when the first read missed it (a deleted
   * post, or one past the end of the history), reads the page that ends at it
   * instead — the fallback the SPA used to spend a second round trip on.
   */
  anchorId?: number;
}

export interface SendMessageParams {
  chatId: PeerId;
  text: string;
  /**
   * Id of the message to reply to, in the same chat.
   */
  replyTo?: number;
  /**
   * Client-chosen Telegram `random_id` as a positive decimal 64-bit integer.
   * A retry reuses it so an accepted send is not duplicated.
   */
  randomId?: string;
}

export interface ForwardMessagesParams {
  /**
   * The source chat the messages belong to.
   */
  chatId: PeerId;
  /**
   * The destination chat; the account must be allowed to post there.
   */
  toChatId: PeerId;
  /**
   * Ids of the messages to forward, in the source chat. An album forwards as
   * its members; Telegram caps a forward at 100 messages.
   */
  messageIds: number[];
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

export interface PressCallbackButtonParams {
  chatId: PeerId;
  messageId: number;
  /**
  Base64 of the button's callback payload, exactly as `MessageButtonDto.data`
  carried it.
  */
  data: string;
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
  /**
   * Client-chosen Telegram `random_id`, reused by a retry so an accepted
   * comment is not duplicated.
   */
  randomId?: string;
}

export interface GetBotCommandsParams {
  chatId: PeerId;
  /**
   * A channel post whose comment thread is the target: the commands belong to
   * the linked discussion group the engine resolves for the post, not to
   * `chatId`. Omitted for a chat's own menu.
   */
  messageId?: number;
}

export interface GetProfileParams {
  /**
   * The marked peer id whose profile is read.
   */
  chatId: PeerId;
}

export interface GetMeResult {
  me: MeDto;
}

export interface GetDialogsResult {
  dialogs: DialogDto[];
}

/**
The state a chat was left in: `true` when it is in the archive.
*/
export interface SetArchivedResult {
  chatId: PeerId;
  archived: boolean;
}

export interface GetHistoryResult {
  messages: MessageDto[];
}

export interface SendMessageResult {
  message: MessageDto;
}

export interface SendUploadGroupResult {
  /**
   * The album's messages, oldest first, as Telegram returned them.
   */
  messages: MessageDto[];
}

export interface ForwardMessagesResult {
  /**
   * The forwarded copies, as Telegram returned them in the destination chat.
   */
  messages: MessageDto[];
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

export interface PressCallbackButtonResult {
  /**
  The text the bot answered with, for a toast or alarm; null when it answered
  silently.
  */
  text: string | null;
  /**
  Whether Telegram asked for a blocking alert instead of a toast.
  */
  alert: boolean;
  /**
  A URL the bot asked the client to open, or null.
  */
  url: string | null;
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
   * Slash commands of the linked discussion group; empty while the thread does
   * not exist yet. The comments composer posts into that group.
   */
  commands: BotCommandDto[];
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

export interface GetBotCommandsResult {
  /**
   * The chat's slash commands in Telegram's order. Group chats aggregate the
   * commands of their bots, de-duplicated by name.
   */
  commands: BotCommandDto[];
}

export interface GetProfileResult {
  profile: ProfileDto;
}
