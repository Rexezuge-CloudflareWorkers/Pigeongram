import type { UploadKind } from './types';

/**
 * Browser-side upload preparation: choosing the Telegram media kind from the
 * file's MIME type and, when needed, normalising images into the JPEG the
 * photo path expects.
 */

const JPEG_QUALITY = 0.9;

export interface PreparedUpload {
  kind: UploadKind;
  body: Blob;
  fileName: string;
  mime: string;
  width?: number;
  height?: number;
  duration?: number;
}

export function mediaKind(file: File): UploadKind {
  const mime = file.type.toLowerCase();
  if (mime === 'image/gif') return 'animation';
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'photo';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
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
