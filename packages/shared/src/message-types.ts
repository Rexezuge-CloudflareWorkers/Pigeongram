/**
 * The message-write half of the JSON contract: the params and results of the
 * calls that change a chat's contents.
 *
 * Split from `rpc-types.ts` to stay under the god-file cap, and because a
 * write's shape is read beside the engine entry that runs it
 * (`session/rpc-messages.ts`) rather than the read half's. Re-exported from
 * `rpc-types.ts`, so the one copy stays reachable through the same import.
 */

import type { MessageDto, MessagePollDto, PeerId } from './types';

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

/**
Replaces the text of one of the account's own messages.

Telegram allows an edit of a text message at any age, but not of a service
message, and it refuses an edit that changes nothing (`MESSAGE_NOT_MODIFIED`,
mapped to `409 conflict`). The bridge offers the text half only for now: a
media caption, a poll and a link preview's edit are separate slices.
*/
export interface EditMessageParams {
  chatId: PeerId;
  /**
   * Id of the message to edit, in that chat.
   */
  messageId: number;
  /**
   * The message's new text. Telegram rejects a blank edit, so it must be
   * non-empty.
   */
  text: string;
}

export interface EditMessageResult {
  /**
   * The message as Telegram now holds it, `editDate` included.
   */
  message: MessageDto;
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

/**
Deletes messages for both sides.

Telegram's `revoke` is always on: a "delete for me" is session-scoped on
Telegram's side, so a message deleted that way would come back if this
engine's session were ever re-created. The bridge does not offer it.
*/
export interface DeleteMessagesParams {
  chatId: PeerId;
  /**
   * Ids of the messages to delete, in that chat. An album goes as its members;
   * Telegram caps a delete at 100 messages.
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

export interface SendMessageResult {
  message: MessageDto;
}

export interface ForwardMessagesResult {
  /**
   * The forwarded copies, as Telegram returned them in the destination chat.
   */
  messages: MessageDto[];
}

export interface DeleteMessagesResult {
  /**
   * The chat the messages were deleted from.
   */
  chatId: PeerId;
  /**
   * The ids Telegram accepted.
   */
  messageIds: number[];
}

export interface SendReactionResult {
  /**
   * The reacted message, when Telegram returned it; `null` otherwise.
   */
  message: MessageDto | null;
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
