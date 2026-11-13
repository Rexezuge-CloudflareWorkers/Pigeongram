/**
 * The RPC half of the JSON contract: the method names exposed over
 * `POST /user/rpc` with their parameters and results. Split from `types.ts`
 * and `chat-link-types.ts` to stay under the god-file cap.
 */

import type { BotCommandDto, DialogDto, MeDto, MessageDto, PeerId, ProfileDto } from './types';

export type {
  ChatInvitePreviewDto,
  JoinChatParams,
  JoinChatResult,
  JoinInviteParams,
  JoinInviteResult,
  ResolveChatParams,
  ResolveChatResult,
  ResolveInviteParams,
  ResolveInviteResult,
} from './chat-link-types';
export type {
  DeleteMessagesParams,
  DeleteMessagesResult,
  ForwardMessagesParams,
  ForwardMessagesResult,
  GetPollResultsParams,
  GetPollResultsResult,
  PressCallbackButtonParams,
  PressCallbackButtonResult,
  ReadHistoryParams,
  SendMessageParams,
  SendMessageResult,
  SendReactionParams,
  SendReactionResult,
  SendVoteParams,
  SendVoteResult,
} from './message-types';

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
  | 'deleteMessages'
  | 'readHistory'
  | 'searchMessages'
  | 'searchGlobal'
  | 'sendReaction'
  | 'sendVote'
  | 'pressCallbackButton'
  | 'getPollResults'
  | 'getComments'
  | 'sendComment'
  | 'getBotCommands'
  | 'setArchived'
  | 'setPinned'
  | 'getProfile'
  | 'resolveChat'
  | 'joinChat'
  | 'resolveInvite'
  | 'joinInvite'
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
moves a chat between the chat list and the archive, and `setPinned` because it
changes the pinned block.
*/
export type BatchableRpcMethod =
  | 'getMe'
  | 'getDialogs'
  | 'getHistory'
  | 'searchMessages'
  | 'searchGlobal'
  | 'getPollResults'
  | 'getComments'
  | 'getBotCommands'
  | 'getProfile'
  | 'resolveChat'
  | 'resolveInvite';

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
  /**
  The bridge code the failure maps to (`not_found`, `conflict`, …), so the
  caller can tell a chat Telegram no longer offers from a failed read without
  matching on prose.
  */
  code?: string;
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

/**
Pins a chat in its list, or unpins it.
*/
export interface SetPinnedParams {
  chatId: PeerId;
  /**
   * `true` pins the chat, `false` unpins it.
   */
  pinned: boolean;
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

/**
The state a chat was left in: `true` when it is pinned in its list.
*/
export interface SetPinnedResult {
  chatId: PeerId;
  pinned: boolean;
}

export interface GetHistoryResult {
  messages: MessageDto[];
}

export interface SendUploadGroupResult {
  /**
   * The album's messages, oldest first, as Telegram returned them.
   */
  messages: MessageDto[];
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

/**
Telegram's commands in their order — a group's are de-duplicated by name — and the empty-chat text: a bot's description, or a chat's about; null when none.
*/
export interface GetBotCommandsResult {
  commands: BotCommandDto[];
  description: string | null;
}

export interface GetProfileResult {
  profile: ProfileDto;
}
