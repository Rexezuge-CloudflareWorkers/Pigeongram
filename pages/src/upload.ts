import { uploadFile, uploadGroup } from './api';
import type { UploadGroupItem } from './api';
import type { MessageDto, PeerId, UploadKind } from './types';

/**
 * Browser-side upload preparation and batching: choosing the Telegram media
 * kind from the file's MIME type, normalising images into the JPEG the photo
 * path expects, and sending a reviewed selection either as one album or as
 * sequential messages.
 */

const JPEG_QUALITY = 0.9;

/**
 * Telegram albums hold at most 10 items; the upload dialog enforces the same
 * bound before the manifest is built.
 */
export const MAX_UPLOAD_ITEMS = 10;

export interface PreparedUpload {
  kind: UploadKind;
  body: Blob;
  fileName: string;
  mime: string;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * What the composer's upload dialog hands to a controller: the reviewed files,
 * the caption that was in the box, the reply target and the group choice.
 */
export interface UploadRequest {
  files: File[];
  caption: string;
  replyTo?: number;
  grouped: boolean;
}

/**
 * The bridge coordinates shared by one file and by an album.
 */
export interface UploadDestination {
  chatId: PeerId;
  commentTo?: number;
  replyTo?: number;
}

export function mediaKind(file: File): UploadKind {
  const mime = file.type.toLowerCase();
  if (mime === 'image/gif') return 'animation';
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'photo';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Whether a selection can be one Telegram album: 2–10 items of one class.
 * Photos, videos and GIFs mix; documents only group with documents. Telegram
 * rejects other combinations, so the dialog disables the option instead of
 * letting the upload fail.
 */
export function canGroupUploads(files: readonly File[]): boolean {
  return files.length >= 2 && files.length <= MAX_UPLOAD_ITEMS && groupableKinds(files.map(mediaKind));
}

/**
 * Prepares and sends a reviewed selection. Grouped selections become one album
 * when the prepared kinds still agree; everything else is sent message by
 * message, with the caption riding the first item only. `onSent` is called as
 * each message lands, so a later failure keeps the successes in the UI.
 *
 * `randomIds` are the client-chosen Telegram ids, one per file: a retry of a
 * single-file send reuses the id, so Telegram drops the duplicate if the first
 * attempt actually landed. An album has no client-chosen id (Telegram picks
 * the group's), so the ids are ignored there.
 */
export async function sendUploadBatch(
  destination: UploadDestination,
  request: UploadRequest,
  onProgress: (fraction: number | null) => void,
  onSent: (message: MessageDto) => void,
  randomIds?: readonly string[],
): Promise<void> {
  const prepared: PreparedUpload[] = [];
  for (const file of request.files) {
    prepared.push(await prepareUpload(file));
  }
  if (prepared.length === 0) return;

  if (request.grouped && prepared.length > 1 && prepared.length <= MAX_UPLOAD_ITEMS && groupableKinds(prepared.map((item) => item.kind))) {
    const body = new Blob(prepared.map((item) => item.body));
    const result = await uploadGroup(
      {
        ...destination,
        items: prepared.map(uploadItem),
        ...(request.caption.length > 0 && { caption: request.caption }),
      },
      body,
      onProgress,
    );
    for (const message of result.messages) onSent(message);
    return;
  }

  for (const [index, item] of prepared.entries()) {
    const randomId = randomIds?.[index];
    const result = await uploadFile(
      {
        ...destination,
        ...uploadItem(item),
        ...(index === 0 && request.caption.length > 0 && { caption: request.caption }),
        ...(randomId !== undefined && { randomId }),
      },
      item.body,
      (fraction) => onProgress((index + fraction) / prepared.length),
    );
    onSent(result.message);
  }
}

function uploadItem(item: PreparedUpload): UploadGroupItem {
  return {
    kind: item.kind,
    fileName: item.fileName,
    mime: item.mime,
    size: item.body.size,
    ...(item.width !== undefined && { width: item.width }),
    ...(item.height !== undefined && { height: item.height }),
    ...(item.duration !== undefined && { duration: item.duration }),
  };
}

function groupableKinds(kinds: readonly UploadKind[]): boolean {
  const visual = kinds.every((kind) => kind === 'photo' || kind === 'video' || kind === 'animation');
  const documents = kinds.every((kind) => kind === 'document');
  return visual || documents;
}

/**
 * Picks the media kind and prepares the bytes for it: non-JPEG images that
 * the canvas can decode are converted to JPEG (`inputMediaUploadedPhoto`
 * expects photo formats), everything undecodable falls back to a document.
 * Videos gain their intrinsic size/duration when the browser can read it.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  let kind = mediaKind(file);
  let body: Blob = file;
  let fileName = file.name || 'file';
  let mime = file.type || 'application/octet-stream';

  if (kind === 'photo' && mime !== 'image/jpeg') {
    const converted = await convertToJpeg(file);
    if (converted) {
      body = converted;
      fileName = jpegName(fileName);
      mime = 'image/jpeg';
    } else {
      kind = 'document';
    }
  }

  if (kind === 'video') {
    const metadata = await readVideoMetadata(file);
    if (metadata) return { kind, body, fileName, mime, ...metadata };
  }
  return { kind, body, fileName, mime };
}

async function convertToJpeg(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    // JPEG has no alpha channel; Telegram renders photo transparency as white.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  } catch {
    return null;
  }
}

function jpegName(name: string): string {
  const withoutExtension = name.replace(/\.[^./\\]+$/, '');
  return `${withoutExtension || 'photo'}.jpg`;
}

function readVideoMetadata(file: File): Promise<{ width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (metadata: { width: number; height: number; duration: number } | null): void => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(metadata);
    };
    const timer = setTimeout(() => finish(null), 5000);
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      // Container durations can be `Infinity` (live/streaming formats); the
      // engine drops non-integers, and Telegram defaults a missing duration.
      const duration = Number.isFinite(video.duration) ? Math.max(1, Math.round(video.duration)) : 1;
      finish({ width: video.videoWidth, height: video.videoHeight, duration });
    });
    video.addEventListener('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    video.src = url;
  });
}
