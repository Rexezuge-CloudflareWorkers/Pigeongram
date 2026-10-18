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

export interface ChatDto {
  id: PeerId;
  kind: ChatKind;
  title: string;
  username: string | null;
  /**
  Opaque token identifying the current profile photo, or null.
  */
  photo: string | null;
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

export interface MessageDto {
  id: number;
  chatId: PeerId;
  senderId: PeerId | null;
  senderName: string | null;
  outgoing: boolean;
  /**
  Unix milliseconds.
  */
  date: number;
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
  The message's downloadable media, or null for text/service messages.
  */
  media: MessageMediaDto | null;
  /**
  The message this one replies to, or null for a plain message.
  */
  reply: MessageReplyDto | null;
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
  pinned: boolean;
  muted: boolean;
}

export type UpdateEvent =
  | { type: 'new_message'; message: MessageDto }
  | { type: 'edit_message'; message: MessageDto }
  | { type: 'reactions'; chatId: PeerId; messageId: number; reactions: MessageReactionDto[] }
  | { type: 'read'; chatId: PeerId; maxId: number; unread: number };

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
  'getMe' | 'getDialogs' | 'getHistory' | 'sendMessage' | 'readHistory' | 'searchMessages' | 'sendReaction' | 'getComments' | 'sendComment';

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
