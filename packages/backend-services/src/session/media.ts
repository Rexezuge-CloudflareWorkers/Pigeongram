import type { Audio, Document, FileLocation, MessageMedia, Photo, Sticker, Thumbnail, Video, Voice } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { MEDIA_WINDOW_BYTES } from './config';
import { EngineError } from './errors';
import type { MediaRange } from './media-window';
import { planWindow } from './media-window';
import type { MediaTargetCache } from './media-targets';
import { DOWNLOAD_BUFFER_BYTES, RANGE_BUFFER_BYTES, windowedStream } from './media-stream';
import type { StickerRegistry } from './sticker-registry';
import { resolveQuality } from './media-quality';
import { webPagePhoto } from './web-page';

/**
Media downloads.

Downloads resolve the file location (`file_reference` included) at request
time from the message or peer itself, so the SPA never carries locations
around. Uploads live in `upload.ts`; both stream through mtcute without
buffering the payload in the isolate.
*/

export type AvatarSize = 'small' | 'big';

export interface MediaDownload {
  stream: ReadableStream<Uint8Array>;
  /**
  MIME type to serve the bytes as.
  */
  mime: string;
  /**
  Size of the full file in bytes, when known.
  */
  size: number | null;
  /**
  Size of this response's body in bytes, when known.
  */
  length: number | null;
  status: 200 | 206;
  /**
  `bytes start-end/size` when the response is partial, else null.
  */
  contentRange: string | null;
  /**
  The entity tag of the bytes, when Telegram gave the file a stable id.
  `If-Range`/`If-None-Match` are answered against it, so a player can resume
  a partial download without mixing two versions of a file.
  */
  etag: string | null;
}

export interface MessageMediaOptions {
  thumb?: boolean;
  range?: MediaRange;
  /**
  Stream variant for a video: `0` is the primary document, `1..n` select
  Telegram's alternative qualities (highest resolution first, one per
  resolution), and `max` resolves to the largest variant. Resolved server-side
  from the message; the client never carries file references. Ignored for
  non-video media and thumbnails.
  */
  quality?: number | 'max';
}

/**
Streams a message's media (photo, video, audio, voice, sticker, document),
or the photo of a link preview.

`thumb: true` resolves a bubble-sized preview instead — the poster for a
video or the largest preview of a photo within {@link PREVIEW_MAX_EDGE}. A
`range` produces a partial
response from the closest part-aligned offset, which is what lets `<video>`
seek without downloading the whole file (`media-stream.ts` cuts the window
itself, for the reason documented there). `quality` selects a video variant
server-side (`0` primary, `1..n` alternatives, `max` largest); downloads ask
for `max` so they always fetch the highest quality, while playback uses the
chosen variant.

`cache` keeps the resolved message between the many range requests one
`<video>` makes; a download failure evicts the entry so a stale
`file_reference` is not reused.
*/
export async function streamMessageMedia(
  client: TelegramClient,
  chatId: number,
  messageId: number,
  options: MessageMediaOptions = {},
  mediaWindowBytes = MEDIA_WINDOW_BYTES,
  cache?: MediaTargetCache,
): Promise<MediaDownload> {
  const cached = cache?.get(chatId, messageId) ?? null;
  const file = cached ?? (await resolveMessageMedia(client, chatId, messageId));
  if (!cached) cache?.set(chatId, messageId, file);
  const store = cache;
  const onSourceError = store ? (): void => store.delete(chatId, messageId) : undefined;
  return streamResolvedMedia(client, file, options, mediaWindowBytes, onSourceError);
}

/**
Reads the message behind a media request. One Telegram round trip, and the
only one a cached range request pays.
*/
async function resolveMessageMedia(client: TelegramClient, chatId: number, messageId: number): Promise<DownloadableMedia> {
  const [message] = await client.getMessages(chatId, [messageId]);
  if (!message) throw new EngineError('Message not found', 404);
  const file = downloadableMedia(message.media);
  if (!file) {
    throw new EngineError('Message has no downloadable media', 400);
  }
  return file;
}

function streamResolvedMedia(
  client: TelegramClient,
  file: DownloadableMedia,
  options: MessageMediaOptions,
  mediaWindowBytes: number,
  onSourceError?: (error: unknown) => void,
): MediaDownload {
  if (options.thumb === true) {
    const thumb = pickThumbnail(file.thumbnails);
    if (!thumb) throw new EngineError('Message media has no thumbnail', 404);
    return fullDownload(client, thumb, 'image/jpeg', false, onSourceError);
  }

  const target = resolveQuality(file, options.quality);
  // Photos are served whole: their `fileSize` is derived from Telegram's size
  // list, which is good enough for bounds but not for a `content-range`
  // promise. Videos and documents carry exact sizes and support seeking.
  if (!target.exactSize || !options.range) {
    return fullDownload(client, target.location, target.mime, target.exactSize, onSourceError);
  }
  return rangedDownload(client, target.location, target.mime, options.range, mediaWindowBytes, onSourceError);
}

/**
Streams one sticker from the engine's registry, addressed by the document id
the picker was given.

`preview` resolves the sticker's own thumbnail, which is what a picker cell
renders: a static sticker may be served whole, while an animated or video one
has no still frame in its payload and must use the thumbnail. The full file is
what a settled message fetches.
*/
export async function streamSticker(
  client: TelegramClient,
  registry: StickerRegistry,
  documentId: string,
  preview: boolean,
): Promise<MediaDownload> {
  const sticker = registry.get(documentId);
  if (!sticker) throw new EngineError('Sticker not found', 404);
  if (preview) {
    const thumb = pickThumbnail(sticker.thumbnails);
    if (thumb) return fullDownload(client, thumb, 'image/webp', false);
    if (sticker.sourceType !== 'static') throw new EngineError('Sticker has no thumbnail', 404);
  }
  return fullDownload(client, sticker, sticker.mimeType || 'image/webp', true);
}

/**
A profile photo, whole.
*/
export interface AvatarImage {
  mime: string;
  bytes: Uint8Array;
  /**
  The version token that identifies this photo. Telegram changes it when
  the photo changes, so it is the cache key — and it comes from the engine,
  never from the caller.
  */
  version: string;
}

/**
Reads a peer's profile photo whole, with the version token that identifies
it.

Avatars are small, so they are buffered rather than streamed: the engine
keeps the bytes, and a repeat request never reaches Telegram again.
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
The version token of a peer's profile photo, or null when the peer has no
photo. It identifies the bytes without reading them, so the engine can
answer from its cache without asking Telegram.
*/
export async function readAvatarVersion(client: TelegramClient, chatId: number, size: AvatarSize): Promise<string | null> {
  const peer = await client.getPeer(chatId).catch(() => null);
  if (!peer?.photo) return null;
  return peer.photo[size].uniqueFileId;
}

/**
Collects a chunk stream into one buffer.
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
A full (status 200) download. `exactSize` says whether `location.fileSize`
is the true byte length — for photos it is derived from the size list, so it
is used for bounds but not promised as `content-length`; without it the
window runs to the end of the file.
*/
function fullDownload(
  client: TelegramClient,
  location: FileLocation,
  mime: string,
  exactSize: boolean,
  onSourceError?: (error: unknown) => void,
): MediaDownload {
  // `size` is the trustworthy total behind `accept-ranges`/`content-range`
  // (seeking); it stays gated on `exactSize`, since a derived photo size is
  // not a promise a browser can seek against. `length` is this response's body
  // in bytes, and a full download always serves exactly `fileSize` of them, so
  // it is promised whenever Telegram gave us a size — including photos, whose
  // download otherwise shows as "streaming" with no total. The stream is cut
  // to the same count so the two cannot disagree.
  const fileSize = location.fileSize ?? null;
  const size = exactSize ? fileSize : null;
  return {
    stream: windowedStream(client, location, {
      offset: 0,
      drop: 0,
      length: fileSize,
      bufferBytes: DOWNLOAD_BUFFER_BYTES,
      onSourceError,
    }),
    mime,
    size,
    length: fileSize,
    status: 200,
    contentRange: null,
    etag: entityTag(location),
  };
}

function rangedDownload(
  client: TelegramClient,
  location: FileLocation,
  mime: string,
  range: MediaRange,
  mediaWindowBytes: number,
  onSourceError?: (error: unknown) => void,
): MediaDownload {
  const size = location.fileSize ?? null;
  if (size === null) {
    // Without a known size there is no `content-range` to promise; serve the
    // whole file instead of a partial response the browser cannot verify.
    return fullDownload(client, location, mime, false, onSourceError);
  }

  const plan = planWindow(range, size, mediaWindowBytes);
  const end = plan.offset + plan.drop + plan.length - 1;
  return {
    stream: windowedStream(client, location, {
      offset: plan.offset,
      drop: plan.drop,
      length: plan.length,
      partSize: plan.partSize,
      bufferBytes: Math.min(RANGE_BUFFER_BYTES, plan.length),
      onSourceError,
    }),
    mime,
    size,
    length: plan.length,
    status: 206,
    contentRange: `bytes ${plan.offset + plan.drop}-${end}/${size}`,
    etag: entityTag(location),
  };
}

/**
The stable entity tag of a file location, when Telegram gave one. The id
changes when the file does, so it is a valid `ETag` for conditional and
resumable requests.
*/
function entityTag(location: FileLocation): string | null {
  const uniqueFileId = (location as FileLocation & { uniqueFileId?: string }).uniqueFileId;
  return typeof uniqueFileId === 'string' && uniqueFileId.length > 0 ? `"${uniqueFileId}"` : null;
}

/**
The message-media union members that are file locations (everything a
`/user/file` request can stream). A web page preview's photo is one: the
card fetches it through the same route, while the page itself is never
contacted.
*/
export type DownloadableMedia = Photo | Video | Audio | Voice | Sticker | Document;

/**
Narrows `MessageMedia` (which also covers polls, geo points, …) to the file
behind a `/user/file` request, if there is one. A web page preview resolves
to its photo; every other non-file media resolves to null.
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

/**
The largest edge a bubble preview may have. A photo's thumbnail list also
carries its full-size image, so `thumb: true` picks the largest entry that
still fits a bubble; the viewer is what asks for the original.
*/
const PREVIEW_MAX_EDGE = 800;

function previewEdge(thumb: Thumbnail): number {
  return Math.max(thumb.width, thumb.height);
}

function pickThumbnail(thumbnails: ReadonlyArray<Thumbnail>): Thumbnail | null {
  let largest: Thumbnail | null = null;
  let preview: Thumbnail | null = null;
  for (const thumb of thumbnails) {
    // Video thumbnails (animated profile previews) cannot be served as a poster.
    if (thumb.isVideo) continue;
    // The last static entry is the largest.
    largest = thumb;
    if (!Number.isFinite(thumb.width) || !Number.isFinite(thumb.height) || previewEdge(thumb) > PREVIEW_MAX_EDGE) continue;
    if (preview === null || previewEdge(thumb) > previewEdge(preview)) preview = thumb;
  }
  return preview ?? largest ?? thumbnails.at(-1) ?? null;
}
