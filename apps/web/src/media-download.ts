import { fileUrl } from './api';
import type { MessageDto, MessageMediaDto } from './types';

/**
 * The file a downloaded message's media saves under, and the action that
 * starts it.
 *
 * Telegram names documents, videos, audio and stickers itself, so the DTO's
 * `fileName` is used when it exists. A photo's DTO carries neither a name nor
 * a MIME type; the bridge serves every photo message as JPEG, so its name is
 * derived from the message id. The URL is always `/user/file` without
 * `thumb=1`: the bubble may show a thumbnail (an album cell, a video poster),
 * but a download is the original bytes.
 */

const EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
};

export function downloadFileName(message: MessageDto): string {
  const media = message.media;
  if (media?.fileName) return media.fileName;
  return `${media?.kind ?? 'file'}-${message.id}.${extensionOf(media)}`;
}

/**
 * Whether `/user/file` can serve this message's bytes. Polls, geo points and
 * other non-file media have no media DTO.
 */
export function isDownloadable(message: MessageDto): boolean {
  return message.media !== null;
}

/**
 * Starts the download through a temporary same-origin anchor, inside the
 * caller's user gesture. The `/user/file` request carries the Access session
 * cookie like every other bridge request, so no worker change is needed.
 */
export function downloadMedia(message: MessageDto): void {
  const anchor = document.createElement('a');
  anchor.href = fileUrl(message.chatId, message.id);
  anchor.download = downloadFileName(message);
  anchor.rel = 'noreferrer';
  // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function extensionOf(media: MessageMediaDto | null): string {
  // The bridge always serves a photo message as JPEG, and its DTO carries no
  // MIME type to read the extension from.
  if (media?.kind === 'photo') return 'jpg';
  const mime = media?.mime;
  return mime ? (EXTENSIONS[mime] ?? 'bin') : 'bin';
}
