/**
 * The SPA's copy of the bridge contract.
 *
 * This mirrors `worker/src/types.ts` — the two packages are separate builds,
 * so the types are duplicated rather than shared. Keep them in sync when the
 * contract changes.
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

export type RpcMethod = 'getMe' | 'getDialogs' | 'getHistory' | 'sendMessage' | 'readHistory' | 'searchMessages' | 'sendReaction';

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
