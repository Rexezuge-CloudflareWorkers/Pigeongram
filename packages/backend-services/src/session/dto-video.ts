import type { tl } from '@mtcute/core';
import type { VideoQualityDto } from '@pigeongram/shared';
import { variantDocuments } from './video-variants';

/**
 * Streamable variants of a video: the primary document (index 0) followed by
 * Telegram's alternative qualities, when the message carries them. A variant
 * whose attributes cannot be read is skipped rather than taking the message
 * down, and `alt_documents`' non-video HLS/storyboard files are not qualities
 * at all; `variantDocuments` filters those before indexing. The vector is
 * `variantDocuments`' so the index here is the one the streaming engine
 * resolves.
 */
export function videoQualities(media: {
  raw: tl.RawDocument;
  width: number;
  height: number;
  media?: tl.RawMessageMediaDocument;
}): VideoQualityDto[] {
  if (!media.media?.altDocuments?.length) return [];
  return variantDocuments(media).map((document, index) => ({
    index,
    ...qualityOf(document, index === 0 ? media.width : undefined, index === 0 ? media.height : undefined),
  }));
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
