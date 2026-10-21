import { applyNewMessage } from './state';
import type { ChatThread } from './state';
import type { DialogDto, MessageDto, MessageMediaDto, MessageReplyDto, PeerId } from './types';
import { mediaKind } from './upload';

/**
 * The optimistic half of a send: a message the user has composed that is not
 * yet a real Telegram message. It lives beside the thread and the dialogs, not
 * inside them: message ids, read watermarks and reply lookups must stay
 * server-truth while the bridge works.
 */

export type PendingStatus = 'preparing' | 'uploading' | 'sending' | 'failed';

/**
 * The counter behind the random id's fallback, for a runtime without Web
 * Crypto.
 */
let fallbackCounter = 0;

export interface PendingMessage {
  /**
   * Stable key for React and the outbox map.
   */
  key: string;
  /**
   * Monotonic per session; gives the synthetic DTO a negative id without
   * colliding with a real message.
   */
  sequence: number;
  /**
   * Stable Telegram `random_id`: reused when a failed attempt is retried, so
   * Telegram drops a duplicate if the first attempt actually landed.
   */
  randomId: string;
  /**
   * The conversation the bubble belongs to. For a comment this is the
   * discussion group (or the channel before the thread exists).
   */
  chatId: PeerId;
  /**
   * The controller's filter: a chat id for a thread, a post key for comments.
   */
  scope: string;
  kind: 'text' | 'file';
  /**
   * Message text, or the caption of a file.
   */
  text: string;
  /**
   * How many files the entry carries: zero for a text message, one for a
   * single file, more for an album.
   */
  fileCount: number;
  replyTo: number | null;
  /**
   * The replied-to message at send time, so the quote still renders if the
   * thread is reloaded before the send settles.
   */
  replyPreview: MessageDto | null;
  media: MessageMediaDto | null;
  /**
   * Object URL for a local file preview; null for text and undecodable files.
   */
  previewUrl: string | null;
  /**
   * Unix milliseconds.
   */
  createdAt: number;
  status: PendingStatus;
  /**
   * Upload fraction, 0..1.
   */
  progress: number | null;
  failure: string | null;
}

/**
 * A positive 63-bit random id as a decimal string, the shape Telegram's
 * `random_id` takes. Kept positive so it round-trips through the bridge's
 * signed 64-bit parser without a negative-decimal special case.
 */
export function randomMessageId(): string {
  const words = new Uint32Array(2);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    crypto.getRandomValues(words);
    const value = (BigInt(words[0] & 0x7f_ff_ff_ff) << 32n) | BigInt(words[1]);
    return value.toString();
  }
  // Without Web Crypto (an exotic runtime) a timestamp and a counter still
  // give an id Telegram has not seen before.
  fallbackCounter += 1;
  return (BigInt(Date.now()) * 1000n + BigInt(fallbackCounter)).toString();
}

/**
 * The media descriptor a local file shows before Telegram's prepared media
 * arrives. `prepareUpload` may turn the kind into `document` later.
 */
export function pendingMedia(file: File): MessageMediaDto {
  return {
    kind: mediaKind(file),
    fileName: file.name || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    width: null,
    height: null,
    duration: null,
  };
}

export function localPreviewUrl(file: File): string | null {
  if (typeof URL.createObjectURL !== 'function') return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    // Not every environment can make an object URL for a file (jsdom cannot);
    // the pending row falls back to the file's name.
    return null;
  }
}

export function revokePreview(url: string | null): void {
  if (url === null || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // A URL the environment never made cannot be revoked either.
  }
}

/**
 * The synthetic DTO the chat list folds in: outgoing, dated now, with a
 * negative id so it can never be mistaken for a Telegram message.
 */
export function pendingAsMessage(entry: PendingMessage): MessageDto {
  return {
    id: -entry.sequence,
    chatId: entry.chatId,
    groupedId: null,
    senderId: null,
    senderName: null,
    // The account's own message: it has no sender avatar to show.
    senderPhoto: null,
    outgoing: true,
    date: entry.createdAt,
    text: entry.text,
    entities: [],
    reactions: [],
    service: false,
    media: entry.media,
    poll: null,
    markup: null,
    reply: pendingReply(entry),
    forward: null,
    views: null,
    comments: null,
  };
}

function pendingReply(entry: PendingMessage): MessageReplyDto | null {
  if (entry.replyTo === null) return null;
  return {
    origin: 'same_chat',
    messageId: entry.replyTo,
    chatId: null,
    senderName: null,
    date: null,
    text: entry.replyPreview?.text ?? '',
    entities: entry.replyPreview?.entities ?? [],
    mediaKind: entry.replyPreview?.media?.kind ?? null,
    quote: false,
  };
}

/**
 * Overlays pending sends on the server dialogs for rendering only. Applying
 * the newest pending entry of each chat through `applyNewMessage` keeps the
 * pinned/unpinned ordering rule in one place; dropping an entry is the whole
 * rollback.
 */
export function withPendingDialogs(dialogs: DialogDto[], pending: readonly PendingMessage[], activeChatId: PeerId | null): DialogDto[] {
  return pending.reduce((current, entry) => applyNewMessage(current, pendingAsMessage(entry), activeChatId), dialogs);
}

/**
 * The open thread's pending entries, filtered by the thread's chat scope.
 */
export function pendingForThread(pending: readonly PendingMessage[], thread: ChatThread | null): PendingMessage[] {
  if (!thread) return [];
  return pending.filter((entry) => entry.scope === String(thread.chat.id));
}
