import type { TelegramDriver } from './driver';
import type { AvatarCache } from './avatar-cache';
import type { UploadConfig } from './config';
import { EngineError } from './errors';
import { log } from './log';
import type { MediaDownload } from './media';
import { requirePeerId } from './params';
import { parseUploadGroupSpec, parseUploadSpec } from './upload-spec';

/**
 * HTTP shaping for the bridge's media routes (`/user/file`, `/user/avatar`,
 * `/user/upload`, `/user/upload-group`). Kept out of the engine class so it
 * stays about the session, not about query strings and headers.
 */

const FILE_CACHE_SECONDS = 3600;
const AVATAR_CACHE_SECONDS = 86_400;

export async function fileResponse(driver: TelegramDriver, request: Request, url: URL): Promise<Response> {
  const chatId = requirePeerId(parseNumber(url.searchParams.get('chatId')));
  const messageId = requireMessageId(url.searchParams.get('messageId'));
  const range = parseRange(request.headers.get('range'));
  const quality = parseQuality(url.searchParams.get('quality'));
  const download = await driver.streamMessageMedia(chatId, messageId, {
    ...(url.searchParams.get('thumb') === '1' && { thumb: true }),
    ...(range && { range }),
    ...(quality !== null && { quality }),
  });
  return mediaResponse(download, FILE_CACHE_SECONDS);
}

export async function avatarResponse(driver: TelegramDriver, cache: AvatarCache, url: URL): Promise<Response> {
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
    return avatarBytes(cached.mime, cached.bytes);
  }
  const avatar = await driver.readAvatar(chatId, size);
  try {
    cache.write(avatar.version, size, avatar.mime, avatar.bytes);
  } catch (error) {
    // The cache is an optimization: a rejected write (the Free plan's row
    // budget) must still serve the bytes that were just downloaded.
    log.warn('avatar.cache_write_failed', { error });
  }
  return avatarBytes(avatar.mime, avatar.bytes);
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
 * Cancels the request body, ignoring the many ways a stream can already be
 * gone (client abort, driver failure, a locked reader).
 */
async function discardBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // Nothing left to drain.
  }
}

function isImageMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  if (lower === 'image/svg+xml') return false;
  return lower.startsWith('image/');
}

function mediaResponse(download: MediaDownload, cacheSeconds: number): Response {
  const headers: Record<string, string> = {
    'content-type': download.mime,
    'cache-control': `private, max-age=${cacheSeconds}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    'cross-origin-resource-policy': 'same-origin',
    'content-disposition': isImageMime(download.mime) ? 'inline' : 'attachment',
  };
  if (download.length !== null) headers['content-length'] = String(download.length);
  if (download.size !== null) headers['accept-ranges'] = 'bytes';
  if (download.contentRange !== null) headers['content-range'] = download.contentRange;
  return new Response(download.stream, { status: download.status, headers });
}

/**
 * A cached avatar, served whole. The bytes are the ones Telegram sent, so the
 * browser's own cache can hold them for a day like any other profile photo.
 */
function avatarBytes(mime: string, bytes: Uint8Array): Response {
  // Copied into a plain buffer: the storage may hand back a view over a
  // shared buffer, which the response body does not take.
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': mime,
      'content-length': String(body.byteLength),
      'cache-control': `private, max-age=${AVATAR_CACHE_SECONDS}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
      'cross-origin-resource-policy': 'same-origin',
      'content-disposition': 'inline',
    },
  });
}

/**
 * Single-range `bytes=a-b` / `bytes=a-` parsing; anything more elaborate (or
 * malformed) is ignored and answered with the full file, which is always a
 * legal response.
 */
function parseRange(header: string | null): { start: number; end: number | null } | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2].length > 0 ? Number(match[2]) : null;
  if (!Number.isSafeInteger(start) || start < 0) return null;
  if (end !== null && (!Number.isSafeInteger(end) || end < start)) return null;
  return { start, end };
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
