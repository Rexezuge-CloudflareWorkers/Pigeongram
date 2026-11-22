import type { FileLocation, tl } from '@mtcute/core';
import { Document as MtDocument } from '@mtcute/core';
import { EngineError } from './errors';
import { log } from './log';
import type { DownloadableMedia } from './media';
import { variantDocuments } from './video-variants';

/**
Which file a media request streams: the primary document, one of Telegram's
alternative video qualities, or the largest variant for a download.

Split from `media.ts` so the window/stream arithmetic stays there; the two
are the halves of one `/user/file` request.
*/

export interface QualityTarget {
  location: FileLocation;
  /**
  MIME type to serve the bytes as.
  */
  mime: string;
  /**
  Whether the location's `fileSize` is the exact byte length (videos and
  documents). Photos derive a size from Telegram's size list, so it is used
  for bounds but never promised as `content-length`.
  */
  exactSize: boolean;
}

/**
Picks the file to stream for a requested video quality. `file.media` carries
the raw `messageMediaDocument` for a document-backed video, which is the only
shape that can have alternative qualities. Every other request serves the
primary file, so an inapplicable `quality` (e.g. on a photo or a download of a
non-video) never breaks. When a quality *is* requested for a video but no
variant resolves, the fallback is logged: a silently ignored selection looks
like a broken resolution switch.
*/
export function resolveQuality(file: DownloadableMedia, quality: number | 'max' | undefined): QualityTarget {
  if (quality === undefined) return targetOf(file);
  if (file.type !== 'video') return targetOf(file);
  const rawMedia = (file as { media?: tl.RawMessageMediaDocument }).media;
  if (rawMedia?._ !== 'messageMediaDocument') return targetOf(file);
  const variants = variantDocuments(file);
  if (variants.length === 1) {
    log.warn('media.quality_ignored', { quality, reason: 'no_alternative_qualities' });
    return targetOf(file);
  }
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
