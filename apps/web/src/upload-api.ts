import { HttpStatusError } from '@rexezuge/web/api';
import type { PeerId, SendMessageResult, SendUploadGroupResult, UploadKind } from './types';

/**
 * The raw-body upload routes: one file (`POST /user/upload`) and an album
 * (`POST /user/upload-group`). They live apart from the JSON client because
 * they stream their body and report progress, which `fetch` cannot do.
 */

export interface UploadInput {
  chatId: PeerId;
  kind: UploadKind;
  fileName: string;
  mime: string;
  size: number;
  caption?: string;
  /**
  Id of the channel post being commented on, when the upload is a comment.
  */
  commentTo?: number;
  /**
  Id of the message being replied to: a comment when `commentTo` is set,
  otherwise a message in `chatId`.
  */
  replyTo?: number;
  width?: number;
  height?: number;
  duration?: number;
  /**
   * Stable Telegram `random_id` for this attempt; a retry reuses it so an
   * answer lost after Telegram accepted the send cannot duplicate the file.
   */
  randomId?: string;
}

/**
One album member's metadata. Its bytes are the item's slice of the
concatenated request body, so `size` is required and must be exact.
*/
export interface UploadGroupItem {
  kind: UploadKind;
  fileName: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface UploadGroupInput {
  chatId: PeerId;
  items: readonly UploadGroupItem[];
  caption?: string;
  commentTo?: number;
  replyTo?: number;
}

/**
Uploads a file's bytes as the raw body of `POST /user/upload`.

XHR, unlike `fetch`, reports upload progress; the promise resolves once the
engine has sent the message (after the Telegram-side upload), so the last
stretch is only visible as an indeterminate state.
*/
export function uploadFile(input: UploadInput, body: Blob, onProgress?: (fraction: number) => void): Promise<SendMessageResult> {
  const params = new URLSearchParams({
    chatId: String(input.chatId),
    kind: input.kind,
    fileName: input.fileName,
    mime: input.mime,
    size: String(input.size),
  });
  if (input.caption) params.set('caption', input.caption);
  if (input.commentTo !== undefined) params.set('commentTo', String(input.commentTo));
  if (input.replyTo !== undefined) params.set('replyTo', String(input.replyTo));
  if (input.width !== undefined) params.set('width', String(input.width));
  if (input.height !== undefined) params.set('height', String(input.height));
  if (input.duration !== undefined) params.set('duration', String(input.duration));
  if (input.randomId !== undefined) params.set('randomId', input.randomId);
  return sendUpload<SendMessageResult>(`/user/upload?${params.toString()}`, body, onProgress);
}

/**
Uploads 2–10 files as one Telegram album.

The body is the files concatenated in `items` order; the manifest carries each
item's metadata and byte length so the engine can split the stream back apart
without a multipart parser or an in-memory buffer. The manifest is
base64url-encoded JSON to keep non-ASCII file names inside the URL limit.
*/
export function uploadGroup(input: UploadGroupInput, body: Blob, onProgress?: (fraction: number) => void): Promise<SendUploadGroupResult> {
  const params = new URLSearchParams({
    chatId: String(input.chatId),
    manifest: encodeManifest(input.items),
  });
  if (input.caption) params.set('caption', input.caption);
  if (input.commentTo !== undefined) params.set('commentTo', String(input.commentTo));
  if (input.replyTo !== undefined) params.set('replyTo', String(input.replyTo));
  return sendUpload<SendUploadGroupResult>(`/user/upload-group?${params.toString()}`, body, onProgress);
}

/**
Shared raw-body upload transport: XHR so the composer can show browser-to-
worker progress. The engine's own Telegram-side upload has no progress channel,
so the tail of the operation is indeterminate.
*/
function sendUpload<T>(path: string, body: Blob, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    });
    xhr.addEventListener('load', () => {
      const payload = xhr.response as unknown;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as T);
        return;
      }
      reject(uploadFailure(xhr.status, payload));
    });
    xhr.addEventListener('error', () => reject(new HttpStatusError(0, 'Upload failed — network error', null)));
    xhr.addEventListener('abort', () => reject(new HttpStatusError(0, 'Upload cancelled', null)));
    xhr.send(body);
  });
}

/**
Turns an upload failure body into the family's error type.

The engine answers with the canonical `{Exception:{Type,Message}}` envelope;
the legacy `{error, code}` shape is still read during the transition. XHR
cannot use the shared JSON client (it is the only transport that reports
upload progress), so this small decoder mirrors the client's rule.
*/
function uploadFailure(status: number, payload: unknown): HttpStatusError {
  const record = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const exception = record.Exception !== null && typeof record.Exception === 'object' ? (record.Exception as Record<string, unknown>) : {};
  const message =
    typeof exception.Message === 'string'
      ? exception.Message
      : typeof record.error === 'string'
        ? record.error
        : `Upload failed (${status})`;
  const type = typeof exception.Type === 'string' ? exception.Type : typeof record.code === 'string' ? record.code : null;
  return new HttpStatusError(status, message, type);
}

function encodeManifest(items: readonly UploadGroupItem[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(items));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // base64url keeps the manifest inside a URL without percent-encoding, and
  // the padding is dropped: the worker accepts the shorter form.
  return btoa(binary).split('=', 1)[0].replaceAll('+', '-').replaceAll('/', '_');
}
