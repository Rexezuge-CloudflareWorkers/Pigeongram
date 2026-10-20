import type { Audio, Document, FileLocation, MessageMedia, Photo, Sticker, Thumbnail, Video, Voice } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { EngineError } from './errors';
import { windowedStream } from './media-stream';

/**
 * Media downloads.
 *
 * Downloads resolve the file location (`file_reference` included) at request
 * time from the message or peer itself, so the SPA never carries locations
 * around. Uploads live in `upload.ts`; both stream through mtcute without
 * buffering the payload in the isolate.
 */

/**
 * Byte alignment Telegram requires for ranged downloads (`4 KB`).
 */
const RANGE_ALIGNMENT = 4096;

export type AvatarSize = 'small' | 'big';

export interface MediaDownload {
  stream: ReadableStream<Uint8Array>;
  /**
   * MIME type to serve the bytes as.
   */
  mime: string;
  /**
   * Size of the full file in bytes, when known.
   */
  size: number | null;
  /**
   * Size of this response's body in bytes, when known.
   */
  length: number | null;
  status: 200 | 206;
  /**
   * `bytes start-end/size` when the response is partial, else null.
   */
  contentRange: string | null;
}

export interface MessageMediaOptions {
  thumb?: boolean;
  range?: { start: number; end: number | null };
}

/**
 * Streams a message's media (photo, video, audio, voice, sticker, document).
 *
 * `thumb: true` resolves the best thumbnail of the media instead — the poster
 * for a video or the preview of a photo. A `range` produces a partial
 * response from the closest 4 KB-aligned offset, which is what lets `<video>`
 * seek without downloading the whole file (`media-stream.ts` cuts the window
 * itself, for the reason documented there).
 */
export async function streamMessageMedia(
  client: TelegramClient,
  chatId: number,
  messageId: number,
  options: MessageMediaOptions = {},
): Promise<MediaDownload> {
  const [message] = await client.getMessages(chatId, [messageId]);
  if (!message) throw new EngineError('Message not found', 404);
  const media = message.media;
  if (!isDownloadableMedia(media)) {
    throw new EngineError('Message has no downloadable media', 400);
  }

  if (options.thumb === true) {
    const thumb = pickThumbnail(media.thumbnails);
    if (!thumb) throw new EngineError('Message media has no thumbnail', 404);
    return fullDownload(client, thumb, 'image/jpeg', false);
  }

  const photo = media.type === 'photo';
  const mime = photo ? 'image/jpeg' : media.mimeType;
  // Photos are served whole: their `fileSize` is derived from Telegram's size
  // list, which is good enough for bounds but not for a `content-range`
  // promise. Videos and documents carry exact sizes and support seeking.
  if (photo || !options.range) {
    return fullDownload(client, media, mime, !photo);
  }
  return rangedDownload(client, media, mime, options.range);
}

/**
 * Streams a peer's profile photo. The version token the SPA carries is only
 * for cache busting — the photo itself is re-resolved here, so an expired
 * `file_reference` can never leak out of the bridge.
 */
export async function streamAvatar(client: TelegramClient, chatId: number, size: AvatarSize): Promise<MediaDownload> {
  const peer = await client.getPeer(chatId).catch(() => null);
  if (!peer) throw new EngineError('Peer not found', 404);
  const photo = peer.photo;
  if (!photo) throw new EngineError('Peer has no profile photo', 404);
  return fullDownload(client, photo[size], 'image/jpeg', false);
}

/**
 * A full (status 200) download. `exactSize` says whether `location.fileSize`
 * is the true byte length — for photos it is derived from the size list, so it
 * is used for bounds but not promised as `content-length`; without it the
 * window runs to the end of the file.
 */
function fullDownload(client: TelegramClient, location: FileLocation, mime: string, exactSize: boolean): MediaDownload {
  const size = exactSize ? (location.fileSize ?? null) : null;
  return {
    stream: windowedStream(client, location, { offset: 0, drop: 0, length: size }),
    mime,
    size,
    length: size,
    status: 200,
    contentRange: null,
  };
}

function rangedDownload(
  client: TelegramClient,
  location: FileLocation,
  mime: string,
  range: { start: number; end: number | null },
): MediaDownload {
  const size = location.fileSize ?? null;
  if (size === null) {
    // Without a known size there is no `content-range` to promise; serve the
    // whole file instead of a partial response the browser cannot verify.
    return fullDownload(client, location, mime, false);
  }

  const end = Math.min(range.end ?? size - 1, size - 1);
  if (range.start > end) {
    throw new EngineError('Requested range is outside the file', 416);
  }

  // Telegram offsets must be 4 KB-aligned, so start at the closest aligned
  // offset below the request and drop the extra prefix bytes from the stream.
  const aligned = range.start - (range.start % RANGE_ALIGNMENT);
  const length = end - range.start + 1;
  return {
    stream: windowedStream(client, location, { offset: aligned, drop: range.start - aligned, length }),
    mime,
    size,
    length,
    status: 206,
    contentRange: `bytes ${range.start}-${end}/${size}`,
  };
}

/**
 * The message-media union members that are file locations (everything a
 * `/api/file` request can stream).
 */
type DownloadableMedia = Photo | Video | Audio | Voice | Sticker | Document;

/**
 * Narrows `MessageMedia` (which also covers polls, geo points, …) to the
 * members backed by a downloadable file.
 */
function isDownloadableMedia(media: MessageMedia): media is DownloadableMedia {
  switch (media?.type) {
    case 'photo':
    case 'video':
    case 'audio':
    case 'voice':
    case 'sticker':
    case 'document': {
      return true;
    }
    default: {
      return false;
    }
  }
}

function pickThumbnail(thumbnails: ReadonlyArray<Thumbnail>): Thumbnail | null {
  let picked: Thumbnail | null = null;
  for (const thumb of thumbnails) {
    // The last static entry is the largest; video thumbnails (animated
    // profile previews) cannot be served as a poster.
    if (!thumb.isVideo) picked = thumb;
  }
  return picked ?? thumbnails.at(-1) ?? null;
}
