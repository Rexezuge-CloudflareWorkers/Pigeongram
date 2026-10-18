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
}

export type ChatKind = 'user' | 'bot' | 'group' | 'supergroup' | 'channel';

export interface ChatDto {
  id: PeerId;
  kind: ChatKind;
  title: string;
  username: string | null;
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
  service: boolean;
  /**
  Whether the message carries a downloadable photo.
  */
  photo: boolean;
}

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

export type RpcMethod = 'getMe' | 'getDialogs' | 'getHistory' | 'sendMessage' | 'readHistory' | 'searchMessages';

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

export interface SearchMessagesResult {
  messages: MessageDto[];
  nextOffsetId?: number;
}
