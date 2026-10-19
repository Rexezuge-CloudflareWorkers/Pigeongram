/**
 * The JSON contract shared by the worker, the Pages proxy function and the SPA:
 * the DTOs the bridge carries. The RPC method shapes — `RpcMethod`, each
 * method's parameters and results — live in `rpc-types.ts`.
 *
 * The SPA keeps its own copy of these types (`pages/src/types.ts`) because it
 * is a separate build with its own tsconfig; keep the two in sync when the
 * contract changes.
 */

/**
Marked Telegram peer id: users are positive, chats negative, channels `-100…`.
*/
export type PeerId = number;

export interface MeDto {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  /**
  Opaque token identifying the current profile photo, or null. It changes
  when the photo changes and only exists to bust the `/api/avatar` cache.
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
  /**
  Whether the account may post in this chat: broadcast channels are
  admin-only, and a member whose send permission was revoked counts as
  blocked too.
  */
  canSendMessages: boolean;
}

/**
Kinds of rich-text entity the bridge forwards. Mirrors mtcute's
`MessageEntityKind`; the SPA styles the ones it knows and falls back to plain
text for the rest.
*/
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
the SPA slices `text` directly.
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
Kinds of user-visible media the bridge carries. `animation` is Telegram's
GIF-style silent video.
*/
export type MessageMediaKind = 'photo' | 'video' | 'animation' | 'audio' | 'voice' | 'sticker' | 'document';

export interface MessageMediaDto {
  kind: MessageMediaKind;
  /**
  Original file name for documents; null for photos.
  */
  fileName: string | null;
  /**
  MIME type as sent by the uploader, when known.
  */
  mime: string | null;
  /**
  Size in bytes, when known.
  */
  size: number | null;
  width: number | null;
  height: number | null;
  /**
  Duration in seconds for videos/audio/voice.
  */
  duration: number | null;
}

/**
Media kinds `POST /api/upload` accepts. The SPA maps the file's MIME onto one
of these; the engine never guesses from bytes.
*/
export type UploadKind = 'photo' | 'video' | 'animation' | 'document';

export interface DialogDto {
  chat: ChatDto;
  lastMessage: MessageDto | null;
  unread: number;
  /**
  Id of the last read incoming message; incoming messages after it are the
  unread ones. The SPA opens a chat at this watermark instead of the bottom.
  */
  readInboxMaxId: number;
  pinned: boolean;
  muted: boolean;
}

/**
Updates pushed over the `/api/updates` WebSocket.
*/
export type UpdateEvent =
  | { type: 'new_message'; message: MessageDto }
  | { type: 'edit_message'; message: MessageDto }
  | { type: 'reactions'; chatId: PeerId; messageId: number; reactions: MessageReactionDto[] }
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

/**
Messages the SPA sends over the updates socket.
*/
export type ClientSocketMessage = { type: 'hello' } | { type: 'ping' };

/**
Messages the session engine sends over the updates socket.
*/
export type ServerSocketMessage =
  { type: 'ready' } | { type: 'pong' } | { type: 'error'; message: string } | { type: 'update'; update: UpdateEvent };

/**
 * Login phases of the session engine.
 *
 * `scanned` is the window between the phone approving the QR code and the
 * server either completing the login or asking for the 2FA password.
 * `code` is the phone-number flow: a login code was sent and is awaited.
 */
export type LoginPhase = 'unauthorized' | 'qr' | 'scanned' | 'code' | 'password' | 'authorized' | 'error';

export interface EngineStateDto {
  phase: LoginPhase;
  authorized: boolean;
  me: MeDto | null;
  /**
  Present while `phase` is `qr`/`scanned`.
  */
  qrUrl?: string;
  /**
  Unix milliseconds at which `qrUrl` stops being valid.
  */
  qrExpires?: number;
  /**
  The phone number the `code`/`password` phases belong to.
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
  /**
  Set after the server rejected a 2FA password.
  */
  passwordInvalid?: boolean;
  /**
  Present when `phase` is `error`.
  */
  error?: string;
}
