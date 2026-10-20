/**
 * The SPA's copy of the bridge contract.
 *
 * This mirrors `worker/src/types.ts` and `worker/src/rpc-types.ts` — the two
 * packages are separate builds, so the types are duplicated rather than
 * shared. Keep them in sync when the contract changes.
 */

export type PeerId = number;

export interface MeDto {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  /**
  Opaque token identifying the current profile photo, or null.
  */
  photo: string | null;
}

export type ChatKind = 'user' | 'bot' | 'group' | 'supergroup' | 'channel';

/**
One entry of a chat's slash-command menu. Telegram carries the command
without its leading slash; the description is the text the bot registered.
*/
export interface BotCommandDto {
  command: string;
  description: string;
}

export interface ChatDto {
  id: PeerId;
  kind: ChatKind;
  title: string;
  username: string | null;
  /**
  Opaque token identifying the current profile photo, or null.
  */
  photo: string | null;
  /**
  Whether the account may post in this chat: broadcast channels are
  admin-only, and a member whose send permission was revoked counts as
  blocked too.
  */
  canSendMessages: boolean;
}

export type MessageEntityKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'spoiler'
  | 'code'
  | 'pre'
  | 'blockquote'
  | 'text_link'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'mention'
  | 'hashtag'
  | 'cashtag'
  | 'bot_command'
  | 'text_mention'
  | 'emoji'
  | 'date_time'
  | 'bank_card'
  | 'ton_address'
  | 'diff_insert'
  | 'diff_delete'
  | 'diff_replace'
  | 'unknown';

/**
One formatting or link span inside a message text.

`offset`/`length` are UTF-16 code units — the same indexing JS strings use, so
`text` can be sliced directly.
*/
export interface MessageEntityDto {
  offset: number;
  length: number;
  kind: MessageEntityKind;
  /**
  `text_link` only: where the span points.
  */
  url?: string;
  /**
  `pre` only: the code block's language, when known.
  */
  language?: string;
  /**
  `text_mention` only: the mentioned user's id.
  */
  userId?: PeerId;
}

/**
One reaction aggregate on a message.
*/
export interface MessageReactionDto {
  /**
  Unicode emoji (paid reactions are `⭐`), or `null` for a custom emoji.
  */
  emoji: string | null;
  /**
  Decimal document id of a custom emoji reaction, else `null`.
  */
  customEmojiId: string | null;
  count: number;
  /**
  Whether the current user is one of the reactors.
  */
  chosen: boolean;
}

/**
One answer of a poll message.

`voters` and `correct` are only known once Telegram has shared the poll's
results with this account (after answering a quiz, or when the poll does not
hide them); `null` means "not available yet", which is not the same as zero
voters.
*/
export interface MessagePollAnswerDto {
  text: string;
  voters: number | null;
  chosen: boolean;
  /**
  Quizzes only: whether this is the correct answer; null while unknown.
  */
  correct: boolean | null;
}

/**
A poll message.

Polls are media in MTProto, but they carry no file, so they ride beside
`media` instead of inside it. `id` is the decimal poll id Telegram uses to
recognise the poll across updates.
*/
export interface MessagePollDto {
  /**
  Decimal string of Telegram's 64-bit poll id.
  */
  id: string;
  question: string;
  answers: MessagePollAnswerDto[];
  /**
  Total number of voters, when the results are known.
  */
  totalVoters: number | null;
  closed: boolean;
  quiz: boolean;
  /**
  Whether the poll accepts several answers at once.
  */
  multiple: boolean;
  /**
  Whether retracting (or changing) a vote is disabled.
  */
  revotingDisabled: boolean;
  /**
  Whether the results stay hidden until the poll closes.
  */
  hideResultsUntilClose: boolean;
  /**
  Quiz only: the explanation shown after answering, when Telegram sent one.
  */
  solution: string | null;
}

/**
The message a message replies to, mapped from Telegram's reply header.

Same-chat headers carry only the message id, so the SPA resolves the sender
and snippet from the loaded thread; cross-chat headers carry the sender, date
and (sometimes) a media descriptor, but their text usually only exists when
the reply quotes a fragment explicitly.
*/
export interface MessageReplyDto {
  /**
  Where the replied-to message lives.
  */
  origin: 'same_chat' | 'other_chat' | 'private';
  /**
  Id of the replied-to message in its chat; null for private-thread replies.
  */
  messageId: number | null;
  /**
  Marked id of the chat the replied-to message lives in (cross-chat replies only).
  */
  chatId: PeerId | null;
  /**
  The replied-to message's sender name, when the header names one; null for
  same-chat replies.
  */
  senderName: string | null;
  /**
  Unix milliseconds of the replied-to message, when the header carries it.
  */
  date: number | null;
  /**
  Explicit quote text, or the text the header carried; empty when neither is present.
  */
  text: string;
  /**
  Rich-text spans of `text` (empty when the reply has none).
  */
  entities: MessageEntityDto[];
  /**
  Kind of the replied-to message's media, when the header embeds it (cross-chat replies).
  */
  mediaKind: MessageMediaKind | null;
  /**
  Whether the reply quotes a fragment of the replied-to message.
  */
  quote: boolean;
}

/**
Where a forwarded message came from, mapped from Telegram's forward header.

`senderId`/`senderName` are who Telegram credits as the origin: a user, a
channel, or a hidden sender whose name the header carries instead of an id.
`fromChatId`/`fromMessageId` point at the original message for saved-messages
forwards and channel posts.
*/
export interface MessageForwardDto {
  /**
  Marked id of the original sender (a user or a channel); null when the header
  hides it or names no id.
  */
  senderId: PeerId | null;
  /**
  The origin's display name for the "Forwarded from …" header; a hidden
  forward's chosen name, when the header carries one.
  */
  senderName: string | null;
  /**
  Unix milliseconds of the original message's date.
  */
  date: number;
  /**
  Marked id of the chat the original message lived in (saved-messages
  forwards only); null otherwise.
  */
  fromChatId: PeerId | null;
  /**
  Id of the original message in its source chat, when the header carries it.
  */
  fromMessageId: number | null;
  /**
  The original channel post's author signature, when set.
  */
  signature: string | null;
}

export interface MessageDto {
  id: number;
  chatId: PeerId;
  /**
  Album membership: messages sharing a non-null `groupedId` are one album and
  render as one bubble. Decimal string of Telegram's 64-bit group id.
  */
  groupedId: string | null;
  senderId: PeerId | null;
  senderName: string | null;
  outgoing: boolean;
  /**
  Unix milliseconds.
  */
  date: number;
  /**
  The message's text or media caption. Service messages carry no text of
  their own; the bridge fills this with the label the UI renders (currently
  the auto-delete timer change) and leaves it empty for other actions.
  */
  text: string;
  /**
  Rich-text spans of `text` (empty when the message has none).
  */
  entities: MessageEntityDto[];
  /**
  Reaction aggregates, most relevant first (empty when the message has none).
  */
  reactions: MessageReactionDto[];
  service: boolean;
  /**
  The message's downloadable media, or null for text/service messages and
  non-file media such as polls.
  */
  media: MessageMediaDto | null;
  /**
  The message's poll, or null when it is not a poll message.
  */
  poll: MessagePollDto | null;
  /**
  The message this one replies to, or null for a plain message.
  */
  reply: MessageReplyDto | null;
  /**
  Where this message was forwarded from, or null for an original message.
  */
  forward: MessageForwardDto | null;
  /**
  Channel-post view count, or null when Telegram reports none: the message
  does not live in a channel, or the post is too fresh to have been counted.
  */
  views: number | null;
  /**
  Channel-post comments metadata, or null for messages without a thread.
  */
  comments: MessageCommentsDto | null;
}

/**
Channel posts keep their replies in the channel's linked discussion group;
Telegram's `replies` header is the post's pointer into that group.
*/
export interface MessageCommentsDto {
  /**
  Whether the post has a comments section (telegram's `comments` flag).
  */
  hasComments: boolean;
  /**
  Total number of comments in the thread.
  */
  count: number;
  /**
  Marked id of the linked discussion group, when the post names one.
  */
  discussionChatId: PeerId | null;
}

export type MessageMediaKind = 'photo' | 'video' | 'animation' | 'audio' | 'voice' | 'sticker' | 'document';

export interface MessageMediaDto {
  kind: MessageMediaKind;
  fileName: string | null;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  /**
  Duration in seconds for videos/audio/voice.
  */
  duration: number | null;
}

/**
Media kinds `POST /api/upload` accepts.
*/
export type UploadKind = 'photo' | 'video' | 'animation' | 'document';

export interface DialogDto {
  chat: ChatDto;
  lastMessage: MessageDto | null;
  unread: number;
  /**
  Id of the last read incoming message; incoming messages after it are the
  unread ones. The thread opens at this watermark instead of the bottom.
  */
  readInboxMaxId: number;
  pinned: boolean;
  muted: boolean;
}

export type UpdateEvent =
  | { type: 'new_message'; message: MessageDto }
  | { type: 'edit_message'; message: MessageDto }
  | { type: 'reactions'; chatId: PeerId; messageId: number; reactions: MessageReactionDto[] }
  | { type: 'views'; chatId: PeerId; messageId: number; views: number }
  | {
      type: 'poll';
      /**
      Marked id of the chat holding the poll, when the update names one.
      */
      chatId: PeerId | null;
      /**
      Id of the message holding the poll, when the update names one.
      */
      messageId: number | null;
      /**
      Decimal string of the poll id: a short update names neither the chat nor
      the message, so this is what identifies the poll in the SPA.
      */
      pollId: string;
      /**
      The updated poll, or null for a short update that only says "recheck
      this poll" — the SPA refetches it with `getPollResults` then.
      */
      poll: MessagePollDto | null;
    }
  | {
      type: 'read';
      chatId: PeerId;
      maxId: number;
      /**
      Remaining unread count; only meaningful for inbox reads.
      */
      unread: number;
      /**
      Whether the account's own inbox was read (as opposed to the peer reading
      the account's messages); only inbox reads advance `readInboxMaxId`.
      */
      inbox: boolean;
    };

export type ClientSocketMessage = { type: 'hello' } | { type: 'ping' };

export type ServerSocketMessage =
  { type: 'ready' } | { type: 'pong' } | { type: 'error'; message: string } | { type: 'update'; update: UpdateEvent };

export type LoginPhase = 'unauthorized' | 'qr' | 'scanned' | 'code' | 'password' | 'authorized' | 'error';

export interface EngineStateDto {
  phase: LoginPhase;
  authorized: boolean;
  me: MeDto | null;
  qrUrl?: string;
  qrExpires?: number;
  /**
  The phone number a `code`/`password` phase belongs to.
  */
  phone?: string;
  /**
  How the login code was delivered on `phase: 'code'` — `app`, `sms`, `call`, …
  */
  codeType?: string;
  /**
  Set after the server rejected a login code.
  */
  codeInvalid?: boolean;
  passwordInvalid?: boolean;
  error?: string;
}

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
  | 'sendComment'
  | 'getBotCommands';

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
  The reacted message, when Telegram returned it; `null` otherwise.
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
  Comments of one thread window, oldest first.
  */
  comments: MessageDto[];
  /**
  Total number of comments in the thread.
  */
  count: number;
  /**
  Marked id of the linked discussion group; null when the thread does not
  exist yet (no comment was ever posted).
  */
  discussionChatId: PeerId | null;
  /**
  Id of the thread's root message in the discussion group; null when the
  thread does not exist yet.
  */
  discussionMessageId: number | null;
  /**
  Pagination cursor for older comments; absent when the oldest comment is
  loaded.
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
