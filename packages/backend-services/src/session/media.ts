import type { Audio, Document, FileLocation, MessageMedia, Photo, Sticker, Thumbnail, Video, Voice, tl } from '@mtcute/core';
import { Document as MtDocument } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { MEDIA_WINDOW_BYTES } from './config';
import { EngineError } from './errors';
import { windowedStream } from './media-stream';
import { webPagePhoto } from './web-page';

/**
 * Media downloads.
 *
 * Downloads resolve the file location (`file_reference` included) at request
 * time from the message or peer itself, so the SPA never carries locations
 * around. Uploads live in `upload.ts`; both stream through mtcute without
 * buffering the payload in the isolate.
 */

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
  /**
  Stream variant for a video: `0` is the primary document, `1..n` select
  Telegram's alternative qualities in order, and `max` resolves to the largest
  variant. Resolved server-side from the message; the client never carries file
  references. Ignored for non-video media and thumbnails.
  */
  quality?: number | 'max';
}

/**
 * Streams a message's media (photo, video, audio, voice, sticker, document),
 * or the photo of a link preview.
 *
 * `thumb: true` resolves the best thumbnail of the media instead — the poster
 * for a video or the preview of a photo. A `range` produces a partial
 * response from the closest block-aligned offset, which is what lets `<video>`
 * seek without downloading the whole file (`media-stream.ts` cuts the window
 * itself, for the reason documented there). `quality` selects a video variant
 * server-side (`0` primary, `1..n` alternatives, `max` largest); downloads ask
 * for `max` so they always fetch the highest quality, while playback uses the
 * chosen variant.
 */
export async function streamMessageMedia(
  client: TelegramClient,
  chatId: number,
  messageId: number,
  options: MessageMediaOptions = {},
  mediaWindowBytes = MEDIA_WINDOW_BYTES,
): Promise<MediaDownload> {
  const [message] = await client.getMessages(chatId, [messageId]);
  if (!message) throw new EngineError('Message not found', 404);
  const file = downloadableMedia(message.media);
  if (!file) {
    throw new EngineError('Message has no downloadable media', 400);
  }

  if (options.thumb === true) {
    const thumb = pickThumbnail(file.thumbnails);
    if (!thumb) throw new EngineError('Message media has no thumbnail', 404);
    return fullDownload(client, thumb, 'image/jpeg', false);
  }

  const target = resolveQuality(file, message.media, options.quality);
  // Photos are served whole: their `fileSize` is derived from Telegram's size
  // list, which is good enough for bounds but not for a `content-range`
  // promise. Videos and documents carry exact sizes and support seeking.
  if (!target.exactSize || !options.range) {
    return fullDownload(client, target.location, target.mime, target.exactSize);
  }
  return rangedDownload(client, target.location, target.mime, options.range, mediaWindowBytes);
}

/**
A profile photo, whole.
*/
export interface AvatarImage {
  mime: string;
  bytes: Uint8Array;
  /**
   * The version token that identifies this photo. Telegram changes it when
   * the photo changes, so it is the cache key — and it comes from the engine,
   * never from the caller.
   */
  version: string;
}

/**
 * Reads a peer's profile photo whole, with the version token that identifies
 * it.
 *
 * Avatars are small, so they are buffered rather than streamed: the engine
 * keeps the bytes, and a repeat request never reaches Telegram again.
 */
export async function readAvatar(client: TelegramClient, chatId: number, size: AvatarSize): Promise<AvatarImage> {
  const peer = await client.getPeer(chatId).catch(() => null);
  if (!peer) throw new EngineError('Peer not found', 404);
  const photo = peer.photo;
  if (!photo) throw new EngineError('Peer has no profile photo', 404);
  const chosen = photo[size];
  return { mime: 'image/jpeg', bytes: await collect(client.downloadAsIterable(chosen, {})), version: chosen.uniqueFileId };
}

/**
 * The version token of a peer's profile photo, or null when the peer has no
 * photo. It identifies the bytes without reading them, so the engine can
 * answer from its cache without asking Telegram.
 */
export async function readAvatarVersion(client: TelegramClient, chatId: number, size: AvatarSize): Promise<string | null> {
  const peer = await client.getPeer(chatId).catch(() => null);
  if (!peer?.photo) return null;
  return peer.photo[size].uniqueFileId;
}

/**
 * Collects a chunk stream into one buffer.
 */
async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    total += chunk.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
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
  mediaWindowBytes: number,
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

  // Telegram parts must not straddle a part block, so start at the closest
  // block below the request and drop the extra prefix bytes from the stream.
  const aligned = range.start - (range.start % mediaWindowBytes);
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
 * `/user/file` request can stream). A web page preview's photo is one: the
 * card fetches it through the same route, while the page itself is never
 * contacted.
 */
type DownloadableMedia = Photo | Video | Audio | Voice | Sticker | Document;

/**
 * Narrows `MessageMedia` (which also covers polls, geo points, …) to the file
 * behind a `/user/file` request, if there is one. A web page preview resolves
 * to its photo; every other non-file media resolves to null.
 */
function downloadableMedia(media: MessageMedia): DownloadableMedia | null {
  if (media?.type === 'webpage') return webPagePhoto(media);
  switch (media?.type) {
    case 'photo':
    case 'video':
    case 'audio':
    case 'voice':
    case 'sticker':
    case 'document': {
      return media;
    }
    default: {
      return null;
    }
  }
}

interface QualityTarget {
  location: FileLocation;
  /**
  MIME type to serve the bytes as.
  */
  mime: string;
  /**
  Whether the location's `fileSize` is the exact byte length (videos and
  documents). Photos derive a size from Telegram's size list, so it is used for
  bounds but never promised as `content-length`.
  */
  exactSize: boolean;
}

/**
Picks the file to stream for a requested video quality. Only a document-backed
video with Telegram alternative qualities is eligible; every other request
serves the primary file, so an inapplicable `quality` (e.g. on a photo or a
download of a non-video) never breaks.
*/
function resolveQuality(file: DownloadableMedia, media: MessageMedia, quality: number | 'max' | undefined): QualityTarget {
  if (quality === undefined) return targetOf(file);
  if (file.type !== 'video' || media?.type !== 'document') return targetOf(file);
  const rawMedia = file.media;
  const alts = (rawMedia?.altDocuments ?? []).filter((document): document is tl.RawDocument => document._ === 'document');
  if (alts.length === 0) return targetOf(file);
  const variants: tl.RawDocument[] = [file.raw, ...alts];
  const chosen = quality === 'max' ? maxVariant(variants) : variantByIndex(variants, quality);
  if (chosen === file.raw) return targetOf(file);
  // A generic document location streams the chosen TL document the same way as
  // the primary; it carries the file reference and size mtcute needs.
  return { location: new MtDocument(chosen), mime: chosen.mimeType || 'video/mp4', exactSize: true };
}

function targetOf(file: DownloadableMedia): QualityTarget {
  const photo = file.type === 'photo';
  return { location: file, mime: photo ? 'image/jpeg' : file.mimeType, exactSize: !photo };
}

function variantByIndex(variants: readonly tl.RawDocument[], index: number): tl.RawDocument {
  if (!Number.isSafeInteger(index) || index < 0 || index >= variants.length) {
    throw new EngineError('quality is out of range', 400);
  }
  return variants[index];
}

function maxVariant(variants: readonly tl.RawDocument[]): tl.RawDocument {
  let best = variants[0];
  let bestPixels = videoPixels(best);
  let bestSize = typeof best.size === 'number' ? best.size : 0;
  for (const variant of variants.slice(1)) {
    const pixels = videoPixels(variant);
    const size = typeof variant.size === 'number' ? variant.size : 0;
    if (pixels <= bestPixels && (pixels !== bestPixels || size <= bestSize)) continue;
    best = variant;
    bestPixels = pixels;
    bestSize = size;
  }
  return best;
}

function videoPixels(document: tl.RawDocument): number {
  const video = document.attributes.find(
    (attribute): attribute is tl.RawDocumentAttributeVideo => attribute._ === 'documentAttributeVideo',
  );
  if (video) return video.w * video.h;
  const image = document.attributes.find(
    (attribute): attribute is tl.RawDocumentAttributeImageSize => attribute._ === 'documentAttributeImageSize',
  );
  return image ? image.w * image.h : 0;
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
