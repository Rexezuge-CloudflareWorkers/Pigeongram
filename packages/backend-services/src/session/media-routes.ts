import type { TelegramDriver } from './driver';
import type { AvatarCache } from './avatar-cache';
import type { UploadConfig } from './config';
import { EngineError, RangeNotSatisfiableError } from './errors';
import { log } from './log';
import type { MediaDownload } from './media';
import type { MediaRange } from './media-window';
import { requirePeerId } from './params';
import { parseUploadGroupSpec, parseUploadSpec } from './upload-spec';
import { MEDIA_CACHE_SECONDS } from './policy';

/**
HTTP shaping for the bridge's media routes (`/user/file`, `/user/avatar`,
`/user/upload`, `/user/upload-group`). Kept out of the engine class so it
stays about the session, not about query strings and headers.
*/

export async function fileResponse(driver: TelegramDriver, request: Request, url: URL): Promise<Response> {
  const chatId = requirePeerId(parseNumber(url.searchParams.get('chatId')));
  const messageId = requireMessageId(url.searchParams.get('messageId'));
  const range = parseRange(request.headers.get('range'));
  const quality = parseQuality(url.searchParams.get('quality'));
  const isDownload = url.searchParams.get('download') === '1';
  const options = {
    ...(url.searchParams.get('thumb') === '1' && { thumb: true }),
    ...(range && { range }),
    ...(quality !== null && { quality }),
  };
  let media: MediaDownload;
  try {
    media = await driver.streamMessageMedia(chatId, messageId, options);
  } catch (error) {
    if (error instanceof RangeNotSatisfiableError) return rangeNotSatisfiable(error.size);
    throw error;
  }

  // An `If-Range` that no longer matches the file must not be answered with a
  // partial response: the browser would splice old bytes onto new ones. The
  // window was only planned, not pulled, so the range is dropped and the file
  // served whole.
  const ifRange = request.headers.get('if-range');
  if (range && media.status === 206 && ifRange !== null && !validatorMatches(ifRange, media.etag)) {
    await discardStream(media.stream);
    media = await driver.streamMessageMedia(chatId, messageId, { ...options, range: undefined });
  } else if (!range && validatorMatches(request.headers.get('if-none-match'), media.etag)) {
    await discardStream(media.stream);
    return notModified(media.etag);
  }

  return mediaResponse(media, isDownload, request.method === 'HEAD');
}

export async function stickerResponse(driver: TelegramDriver, url: URL, method = 'GET'): Promise<Response> {
  const documentId = url.searchParams.get('documentId');
  if (documentId === null || !/^\d+$/.test(documentId)) {
    throw new EngineError('documentId query parameter is required', 400);
  }
  const media = await driver.streamSticker(documentId, url.searchParams.get('thumb') === '1');
  return mediaResponse(media, false, method === 'HEAD');
}

export async function avatarResponse(driver: TelegramDriver, cache: AvatarCache, url: URL, method = 'GET'): Promise<Response> {
  const chatId = requirePeerId(parseNumber(url.searchParams.get('chatId')));
  const size = url.searchParams.get('size') ?? 'small';
  if (size !== 'small' && size !== 'big') {
    throw new EngineError('size must be small or big', 400);
  }
  // The cache key is the version token the engine resolved, never the `v` the
  // caller sent: a caller must not be able to name another peer's bytes.
  const version = await driver.readAvatarVersion(chatId, size);
  const cached = version === null ? null : cache.read(version, size);
  if (cached) {
    return avatarBytes(cached.mime, cached.bytes, method === 'HEAD');
  }
  const avatar = await driver.readAvatar(chatId, size);
  try {
    cache.write(avatar.version, size, avatar.mime, avatar.bytes);
  } catch (error) {
    // The cache is an optimization: a rejected write (the Free plan's row
    // budget) must still serve the bytes that were just downloaded.
    log.warn('avatar.cache_write_failed', { error });
  }
  return avatarBytes(avatar.mime, avatar.bytes, method === 'HEAD');
}

export async function uploadResponse(driver: TelegramDriver, request: Request, url: URL, config: UploadConfig): Promise<Response> {
  try {
    const spec = parseUploadSpec(url, request, config);
    const body = request.body;
    if (!body) throw new EngineError('Upload body is required', 400);
    const counted = countedUploadBody(request, spec.size as number, config.maxUploadBytes);
    const message = await driver.sendUpload(spec, counted, request.signal);
    return Response.json({ message });
  } catch (error) {
    // Refusing an upload while the browser is still streaming the body leaves
    // workerd reading a request whose response has been sent; draining the
    // stream keeps the failure local to this request.
    await discardBody(request);
    throw error;
  }
}

export async function uploadGroupResponse(driver: TelegramDriver, request: Request, url: URL, config: UploadConfig): Promise<Response> {
  try {
    const spec = parseUploadGroupSpec(url, request, config);
    const body = request.body;
    if (!body) throw new EngineError('Upload body is required', 400);
    const total = spec.items.reduce((sum, item) => sum + item.size, 0);
    const counted = countedUploadBody(request, total, config.maxUploadBytes);
    const messages = await driver.sendUploadGroup(spec, counted, request.signal);
    return Response.json({ messages });
  } catch (error) {
    await discardBody(request);
    throw error;
  }
}

function countedUploadBody(request: Request, declared: number, cap: number): ReadableStream<Uint8Array> {
  const body = request.body;
  if (!body) throw new EngineError('Upload body is required', 400);
  const reader = body.getReader();
  let count = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (count !== declared) {
          controller.error(new EngineError('Upload body length does not match the declared size', 400));
          return;
        }
        controller.close();
        return;
      }
      count += value.byteLength;
      // A body longer than the declared sizes is a malformed manifest; fail
      // on the first excess chunk instead of streaming the whole thing only
      // to reject it at end-of-stream.
      if (count > declared) {
        try {
          await reader.cancel();
        } catch {
          // Already gone.
        }
        controller.error(new EngineError('Upload body length does not match the declared size', 400));
        return;
      }
      if (count > cap) {
        try {
          await reader.cancel();
        } catch {
          // Already gone.
        }
        controller.error(new EngineError('Uploads are limited to the configured maximum', 413));
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });
}

/**
Cancels the request body, ignoring the many ways a stream can already be
gone (client abort, driver failure, a locked reader).
*/
async function discardBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // Nothing left to drain.
  }
}

function isInlineMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  if (lower === 'image/svg+xml') return false;
  // Video and audio are what a media element plays: marking them `attachment`
  // made Safari/iOS (and "open in a tab") download instead of play.
  return lower.startsWith('image/') || lower.startsWith('video/') || lower.startsWith('audio/');
}

function mediaResponse(download: MediaDownload, isDownload: boolean, head: boolean): Response {
  const headers: Record<string, string> = {
    'content-type': download.mime,
    'cache-control': `private, max-age=${MEDIA_CACHE_SECONDS}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    'cross-origin-resource-policy': 'same-origin',
    'content-disposition': isDownload || !isInlineMime(download.mime) ? 'attachment' : 'inline',
  };
  if (download.length !== null) headers['content-length'] = String(download.length);
  if (download.size !== null) headers['accept-ranges'] = 'bytes';
  if (download.contentRange !== null) headers['content-range'] = download.contentRange;
  if (download.etag !== null) headers['etag'] = download.etag;
  if (head) {
    // A HEAD is a header probe: the range was planned but never pulled, so the
    // download is released instead of left running for a body nobody reads.
    void download.stream.cancel().catch(() => {});
    return new Response(null, { status: download.status, headers });
  }
  return new Response(download.stream, { status: download.status, headers });
}

/**
The `416` a range past the file end earns. `content-range` is what tells the
player the real length, so a browser can restart from a valid position.
*/
function rangeNotSatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      'content-range': `bytes */${size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    },
  });
}

/**
The `304` a conditional GET earns. The entity tags are stable for the life
of the file, so a revalidating browser reuses its own copy.
*/
function notModified(etag: string | null): Response {
  return new Response(null, {
    status: 304,
    headers: {
      ...(etag !== null && { etag }),
      'cache-control': `private, max-age=${MEDIA_CACHE_SECONDS}`,
    },
  });
}

/**
Whether a request validator (`If-Range` or a possibly comma-separated
`If-None-Match`) names this response's entity tag. A missing tag on either
side is never a match: without an entity tag there is nothing to validate.
*/
function validatorMatches(header: string | null, etag: string | null): boolean {
  if (header === null || etag === null) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((candidate) => candidate.trim() === etag);
}

/**
A cached avatar, served whole. The bytes are the ones Telegram sent, so the
browser's own cache can hold them for a day like any other profile photo.
*/
function avatarBytes(mime: string, bytes: Uint8Array, head: boolean): Response {
  // Copied into a plain buffer: the storage may hand back a view over a
  // shared buffer, which the response body does not take.
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  const headers = {
    'content-type': mime,
    'content-length': String(body.byteLength),
    'cache-control': `private, max-age=${MEDIA_CACHE_SECONDS}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    'cross-origin-resource-policy': 'same-origin',
    'content-disposition': 'inline',
  };
  return new Response(head ? null : body, { status: 200, headers });
}

/**
Single-range parsing: `bytes=a-b`, `bytes=a-` and the suffix form
`bytes=-N`. Anything more elaborate (a multi-range request, another unit)
or malformed is ignored and answered with the full file, which is always a
legal response.

The suffix form needs the file size, so it travels as a length and is
resolved by the download; treating it as "no range" (the old behaviour) sent
a whole video to a player that asked only for its tail.
*/
function parseRange(header: string | null): MediaRange | null {
  if (!header) return null;
  const trimmed = header.trim();
  const bounded = /^bytes=(\d+)-(\d*)$/.exec(trimmed);
  if (bounded) {
    const start = Number(bounded[1]);
    const end = bounded[2].length > 0 ? Number(bounded[2]) : null;
    if (!Number.isSafeInteger(start)) return null;
    if (end !== null && (!Number.isSafeInteger(end) || end < start)) return null;
    return { start, end };
  }
  const suffix = /^bytes=-(\d+)$/.exec(trimmed);
  if (suffix) {
    const length = Number(suffix[1]);
    if (!Number.isSafeInteger(length)) return null;
    return { suffix: length };
  }
  return null;
}

async function discardStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await stream.cancel();
  } catch {
    // Already closed.
  }
}

function parseNumber(value: string | null): number {
  return value === null ? NaN : Number(value);
}

function requireMessageId(value: string | null): number {
  const messageId = parseNumber(value);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    throw new EngineError('messageId query parameter is required', 400);
  }
  return messageId;
}

function parseQuality(value: string | null): number | 'max' | null {
  let quality: number | 'max' | null = null;
  if (value === 'max') {
    quality = 'max';
  } else if (value !== null) {
    quality = parseQualityIndex(value);
  }
  return quality;
}

function parseQualityIndex(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new EngineError('quality must be max or a non-negative integer', 400);
  }
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new EngineError('quality must be max or a non-negative integer', 400);
  }
  return index;
}
