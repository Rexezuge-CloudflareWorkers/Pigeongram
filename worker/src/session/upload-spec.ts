import type { UploadKind } from '../types';
import { EngineError } from './errors';

/**
 * Parsing and validation for the raw-body upload routes.
 *
 * `POST /user/upload` carries one file and its metadata in the query string.
 * `POST /user/upload-group` carries 2–10 files concatenated in order, with the
 * per-item metadata base64url-encoded JSON in the `manifest` query parameter.
 * Both parsers live here — and are imported by the worker entry for its
 * pre-flight — so the engine and the edge agree on every rule before the body
 * is touched.
 */

/**
 * The media fields both routes share.
 */
export interface UploadMediaSpec {
  kind: UploadKind;
  fileName?: string;
  mime?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface UploadSpec extends UploadMediaSpec {
  chatId: number;
  caption?: string;
  /**
  Id of the channel post being commented on, when the upload is a comment.
  */
  commentTo?: number;
  /**
  Id of the message being replied to: a comment in the thread when `commentTo`
  is set, otherwise a message in `chatId`.
  */
  replyTo?: number;
}

/**
 * One member of an album. `size` is required: it is the exact byte range the
 * engine hands to mtcute out of the concatenated request body.
 */
export interface UploadItemSpec extends UploadMediaSpec {
  size: number;
}

export interface UploadGroupSpec {
  chatId: number;
  items: UploadItemSpec[];
  caption?: string;
  commentTo?: number;
  replyTo?: number;
}

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_CAPTION_LENGTH = 1024;
const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const MIN_GROUP_ITEMS = 2;
const MAX_GROUP_ITEMS = 10;
const MANIFEST_MAX_LENGTH = 16 * 1024;
const UPLOAD_KINDS: ReadonlySet<UploadKind> = new Set(['photo', 'video', 'animation', 'document']);

export function parseUploadSpec(url: URL, request: Request, env: CloudflareEnv): UploadSpec {
  const chatId = requirePeerId(parseNumber(url.searchParams.get('chatId')));
  const kind = parseKind(url.searchParams.get('kind'));

  const size = parseQuantity(url.searchParams.get('size'));
  if (size === null) throw new EngineError('size query parameter is required', 400);
  checkDeclaredLength(request, size);
  checkMaxSize(size, env);

  const caption = parseCaption(url.searchParams.get('caption'));
  const commentTo = parseOptionalMessageId(url.searchParams.get('commentTo'), 'commentTo');
  const replyTo = parseOptionalMessageId(url.searchParams.get('replyTo'), 'replyTo');
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
    ...(commentTo !== null && { commentTo }),
    ...(replyTo !== null && { replyTo }),
    ...(fileName !== null && { fileName }),
    ...(mime !== null && { mime }),
    ...(width !== null && { width }),
    ...(height !== null && { height }),
    ...(duration !== null && { duration }),
  };
}

export function parseUploadGroupSpec(url: URL, request: Request, env: CloudflareEnv): UploadGroupSpec {
  const chatId = requirePeerId(parseNumber(url.searchParams.get('chatId')));
  const items = parseManifest(url.searchParams.get('manifest'));
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new EngineError('manifest item sizes are not usable', 400);
  }
  checkDeclaredLength(request, total);
  checkMaxSize(total, env, ' in total');

  const caption = parseCaption(url.searchParams.get('caption'));
  const commentTo = parseOptionalMessageId(url.searchParams.get('commentTo'), 'commentTo');
  const replyTo = parseOptionalMessageId(url.searchParams.get('replyTo'), 'replyTo');

  return {
    chatId,
    items,
    ...(caption !== null && { caption }),
    ...(commentTo !== null && { commentTo }),
    ...(replyTo !== null && { replyTo }),
  };
}

/**
 * Album members must share a media class: photos, videos and GIFs mix (they
 * are visual media), while documents only group with documents. Telegram
 * rejects mixed media and documents in one album; failing here gives a clear
 * 400 instead of a Telegram error after the upload bytes are spent.
 */
function validateAlbumKinds(items: readonly UploadItemSpec[]): void {
  const visual = items.every((item) => item.kind === 'photo' || item.kind === 'video' || item.kind === 'animation');
  const documents = items.every((item) => item.kind === 'document');
  if (!visual && !documents) {
    throw new EngineError('Album items must be photos, videos or GIFs together, or documents together', 400);
  }
}

/**
 * A positive message id from the query string, or null when absent/unusable —
 * but an explicitly present garbage value is an error, not an omission.
 */
function parseOptionalMessageId(value: string | null, name: string): number | null {
  if (value === null) return null;
  const messageId = parseNumber(value);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    throw new EngineError(`${name} must be a positive message id`, 400);
  }
  return messageId;
}

/**
 * Decodes the album manifest: a base64url JSON array of item descriptors. The
 * length cap keeps a hostile query from turning into a large decode before the
 * real validation starts.
 */
function parseManifest(value: string | null): UploadItemSpec[] {
  if (value === null || value.length === 0) {
    throw new EngineError('manifest query parameter is required', 400);
  }
  if (value.length > MANIFEST_MAX_LENGTH) {
    throw new EngineError('manifest is too long', 400);
  }
  const decoded = decodeManifest(value);
  if (!Array.isArray(decoded) || decoded.length < MIN_GROUP_ITEMS || decoded.length > MAX_GROUP_ITEMS) {
    throw new EngineError(`manifest must contain ${MIN_GROUP_ITEMS}-${MAX_GROUP_ITEMS} items`, 400);
  }
  const items = decoded.map((entry, index) => parseManifestItem(entry, index));
  validateAlbumKinds(items);
  return items;
}

function decodeManifest(value: string): unknown {
  let text: string;
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new EngineError('manifest must be base64url-encoded JSON', 400);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EngineError('manifest must be base64url-encoded JSON', 400);
  }
}

function parseManifestItem(value: unknown, index: number): UploadItemSpec {
  const prefix = `items[${index}]`;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineError(`${prefix} must be an object`, 400);
  }
  const record = value as Record<string, unknown>;
  const kind = parseManifestKind(record.kind, prefix);
  const size = parseRequiredQuantity(record.size, `${prefix}.size`);
  const fileName = parseOptionalManifestString(record.fileName, `${prefix}.fileName`, parseFileName);
  const mime = parseOptionalManifestString(record.mime, `${prefix}.mime`, parseMime);
  const width = parseOptionalManifestQuantity(record.width, `${prefix}.width`);
  const height = parseOptionalManifestQuantity(record.height, `${prefix}.height`);
  const duration = parseOptionalManifestQuantity(record.duration, `${prefix}.duration`);

  return {
    kind,
    size,
    ...(fileName !== null && { fileName }),
    ...(mime !== null && { mime }),
    ...(width !== null && { width }),
    ...(height !== null && { height }),
    ...(duration !== null && { duration }),
  };
}

function parseManifestKind(value: unknown, prefix: string): UploadKind {
  if (typeof value !== 'string' || !UPLOAD_KINDS.has(value as UploadKind)) {
    throw new EngineError(`${prefix}.kind must be photo, video, animation or document`, 400);
  }
  return value as UploadKind;
}

function parseOptionalManifestString(value: unknown, name: string, parse: (raw: string) => string | null): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new EngineError(`${name} must be a string`, 400);
  return parse(value);
}

function parseOptionalManifestQuantity(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  return parseRequiredQuantity(value, name);
}

function parseRequiredQuantity(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new EngineError(`${name} must be a positive integer`, 400);
  }
  return value;
}

function checkDeclaredLength(request: Request, size: number): void {
  const declared = parseQuantity(request.headers.get('content-length'));
  if (declared !== null && declared !== size) {
    throw new EngineError('content-length does not match the declared size', 400);
  }
}

function checkMaxSize(size: number, env: CloudflareEnv, suffix = ''): void {
  const maxBytes = maxUploadBytes(env);
  if (size > maxBytes) {
    throw new EngineError(`Uploads are limited to ${formatLimit(maxBytes)}${suffix}`, 413);
  }
}

function maxUploadBytes(env: CloudflareEnv): number {
  const parsed = Number(env.UPLOAD_MAX_BYTES ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_UPLOAD_BYTES;
}

function formatLimit(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
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

function parseNumber(value: string | null): number {
  return value === null ? NaN : Number(value);
}

function requirePeerId(value: number): number {
  if (!Number.isSafeInteger(value) || value === 0) {
    throw new EngineError('chatId query parameter is required', 400);
  }
  return value;
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
