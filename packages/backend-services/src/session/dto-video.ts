import type { tl } from '@mtcute/core';
import type { VideoQualityDto } from '@pigeongram/shared';

/**
 * Streamable variants of a video: the primary document (index 0) followed by
 * Telegram's alternative qualities, when the message carries them. A variant whose
 * attributes cannot be read is skipped rather than taking the message down.
 */
export function videoQualities(media: {
  raw: tl.RawDocument;
  width: number;
  height: number;
  media?: tl.RawMessageMediaDocument;
}): VideoQualityDto[] {
  const alt = media.media?.altDocuments ?? [];
  if (alt.length === 0) return [];
  const variants: VideoQualityDto[] = [{ index: 0, ...qualityOf(media.raw, media.width, media.height) }];
  for (const [index, document] of alt.entries()) {
    if (document._ !== 'document') continue;
    variants.push({ index: index + 1, ...qualityOf(document) });
  }
  return variants;
}

function qualityOf(document: tl.RawDocument, fallbackWidth?: number, fallbackHeight?: number): Omit<VideoQualityDto, 'index'> {
  const video = document.attributes.find(
    (attribute): attribute is tl.RawDocumentAttributeVideo => attribute._ === 'documentAttributeVideo',
  );
  const image = document.attributes.find(
    (attribute): attribute is tl.RawDocumentAttributeImageSize => attribute._ === 'documentAttributeImageSize',
  );
  return {
    width: video?.w ?? image?.w ?? fallbackWidth ?? null,
    height: video?.h ?? image?.h ?? fallbackHeight ?? null,
    size: typeof document.size === 'number' ? document.size : null,
    codec: video?.videoCodec ?? null,
  };
}
