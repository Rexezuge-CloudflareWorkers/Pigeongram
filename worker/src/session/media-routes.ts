import type { TelegramDriver } from './driver';
import type { AvatarCache } from './avatar-cache';
import { EngineError } from './errors';
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
  const download = await driver.streamMessageMedia(chatId, messageId, {
    ...(url.searchParams.get('thumb') === '1' && { thumb: true }),
    ...(range && { range }),
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
    console.warn('[engine] avatar cache write failed', error);
  }
  return avatarBytes(avatar.mime, avatar.bytes);
}

export async function uploadResponse(driver: TelegramDriver, request: Request, url: URL, env: CloudflareEnv): Promise<Response> {
  try {
    const spec = parseUploadSpec(url, request, env);
    const body = request.body;
    if (!body) throw new EngineError('Upload body is required', 400);
    const message = await driver.sendUpload(spec, body, request.signal);
    return Response.json({ message });
  } catch (error) {
    // Refusing an upload while the browser is still streaming the body leaves
    // workerd reading a request whose response has been sent; draining the
    // stream keeps the failure local to this request.
    await discardBody(request);
    throw error;
  }
}

export async function uploadGroupResponse(driver: TelegramDriver, request: Request, url: URL, env: CloudflareEnv): Promise<Response> {
  try {
    const spec = parseUploadGroupSpec(url, request, env);
    const body = request.body;
    if (!body) throw new EngineError('Upload body is required', 400);
    const messages = await driver.sendUploadGroup(spec, body, request.signal);
    return Response.json({ messages });
  } catch (error) {
    await discardBody(request);
    throw error;
  }
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

function mediaResponse(download: MediaDownload, cacheSeconds: number): Response {
  const headers: Record<string, string> = {
    'content-type': download.mime,
    'cache-control': `private, max-age=${cacheSeconds}`,
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
