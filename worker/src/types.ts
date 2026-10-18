/**
 * The JSON contract shared by the worker, the Pages proxy function and the SPA.
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

/**
Updates pushed over the `/api/updates` WebSocket.
*/
export type UpdateEvent =
  | { type: 'new_message'; message: MessageDto }
  | { type: 'edit_message'; message: MessageDto }
  | { type: 'read'; chatId: PeerId; maxId: number; unread: number };

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

export interface WakeCountersDto {
  totalWakes: number;
  failedWakes: number;
  avgWakeMs: number;
  updatesSeen: number;
  lastWakeAt: number | null;
}

export interface DayBucketDto {
  day: string;
  wakes: number;
  failures: number;
  avgMs: number;
  updates: number;
}

export interface StatsDto {
  counters: WakeCountersDto;
  days: DayBucketDto[];
  databaseBytes: number | null;
}

export interface RpcRequestDto {
  method: string;
  params?: Record<string, unknown>;
}

/**
Methods exposed over `POST /api/rpc`.
*/
export type RpcMethod = 'getMe' | 'getDialogs' | 'getHistory' | 'sendMessage' | 'readHistory' | 'searchMessages';

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
}

export interface ReadHistoryParams {
  chatId: PeerId;
}

export interface SearchMessagesParams {
  chatId: PeerId;
  query: string;
  limit?: number;
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

export interface SearchMessagesResult {
  messages: MessageDto[];
  nextOffsetId?: number;
}
