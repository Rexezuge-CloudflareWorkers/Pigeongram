import type { UploadKind } from '../types';
import type { TelegramDriver } from './driver';
import { EngineError } from './errors';
import type { MediaDownload } from './media';
import { requirePeerId } from './params';
import type { UploadSpec } from './upload';

/**
 * HTTP shaping for the bridge's media routes (`/api/file`, `/api/avatar`,
 * `/api/upload`). Kept out of the engine class so it stays about the session,
 * not about query strings and headers.
 */

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_CAPTION_LENGTH = 1024;
const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const FILE_CACHE_SECONDS = 3600;
const AVATAR_CACHE_SECONDS = 86_400;
const UPLOAD_KINDS: ReadonlySet<UploadKind> = new Set(['photo', 'video', 'animation', 'document']);

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

export async function avatarResponse(driver: TelegramDriver, url: URL): Promise<Response> {
  const chatId = requirePeerId(parseNumber(url.searchParams.get('chatId')));
  const size = url.searchParams.get('size') ?? 'small';
  if (size !== 'small' && size !== 'big') {
    throw new EngineError('size must be small or big', 400);
  }
  const download = await driver.streamAvatar(chatId, size);
  return mediaResponse(download, AVATAR_CACHE_SECONDS);
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

/**
 * Parses and validates the raw-body upload request. Pure so the validation
 * rules are testable without a driver.
 */
export function parseUploadSpec(url: URL, request: Request, env: CloudflareEnv): UploadSpec {
  const chatId = requirePeerId(parseNumber(url.searchParams.get('chatId')));
  const kind = parseKind(url.searchParams.get('kind'));

  const size = parseQuantity(url.searchParams.get('size'));
  if (size === null) throw new EngineError('size query parameter is required', 400);
  const declared = parseQuantity(request.headers.get('content-length'));
  if (declared !== null && declared !== size) {
    throw new EngineError('content-length does not match the size parameter', 400);
  }
  const maxBytes = maxUploadBytes(env);
  if (size > maxBytes) {
    throw new EngineError(`Uploads are limited to ${formatLimit(maxBytes)}`, 413);
  }

  const caption = parseCaption(url.searchParams.get('caption'));
  const replyTo = parseOptionalMessageId(url.searchParams.get('replyTo'));
  const fileName = parseFileName(url.searchParams.get('fileName'));
  const mime = parseMime(url.searchParams.get('mime'));
  const width = parseQuantity(url.searchParams.get('width'));
  const height = parseQuantity(url.searchParams.get('height'));
  const duration = parseQuantity(url.searchParams.get('duration'));

  return {
    chatId,
    kind,
    size,
    ...(caption !== null && { caption }),
    ...(replyTo !== null && { replyTo }),
    ...(fileName !== null && { fileName }),
    ...(mime !== null && { mime }),
    ...(width !== null && { width }),
    ...(height !== null && { height }),
    ...(duration !== null && { duration }),
  };
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

/**
A positive message id from the query string, or null when absent/unusable —
but an explicitly present garbage value is an error, not an omission.
*/
function parseOptionalMessageId(value: string | null): number | null {
  if (value === null) return null;
  const messageId = parseNumber(value);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    throw new EngineError('replyTo must be a positive message id', 400);
  }
  return messageId;
}

function parseKind(value: string | null): UploadKind {
  if (value === null || !UPLOAD_KINDS.has(value as UploadKind)) {
    throw new EngineError('kind must be photo, video, animation or document', 400);
  }
  return value as UploadKind;
}

/**
 * A positive integer from the query string, or null when absent/unusable.
 */
function parseQuantity(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseCaption(value: string | null): string | null {
  const caption = (value ?? '').trim();
  if (caption.length === 0) return null;
  if (caption.length > MAX_CAPTION_LENGTH) {
    throw new EngineError(`caption must be at most ${MAX_CAPTION_LENGTH} characters`, 400);
  }
  return caption;
}

function parseFileName(value: string | null): string | null {
  // Control characters have no business in a Telegram file name; the browser
  // sends the original `File.name` here.
  const name = stripControlCharacters(value ?? '').trim();
  if (name.length === 0) return null;
  return name.slice(0, MAX_FILE_NAME_LENGTH);
}

function stripControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) result += character;
  }
  return result;
}

function parseMime(value: string | null): string | null {
  const mime = (value ?? '').trim();
  if (mime.length === 0) return null;
  if (mime.length > MAX_MIME_LENGTH) {
    throw new EngineError('mime is too long', 400);
  }
  return mime;
}

function maxUploadBytes(env: CloudflareEnv): number {
  const parsed = Number(env.UPLOAD_MAX_BYTES ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_UPLOAD_BYTES;
}

function formatLimit(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}
