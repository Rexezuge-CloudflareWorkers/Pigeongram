import type { tl } from '@mtcute/core';

/**
 * MIME types Telegram puts in `alt_documents` that are not video qualities:
 * an HLS manifest and the storyboard files the player uses for previews.
 */
const NON_VIDEO_ALT_MIMES = new Set(['application/x-mpegurl', 'application/x-tgstoryboard', 'application/x-tgstoryboardmap']);

/**
 * The plain TL document behind one streamable video variant: Telegram's
 * primary document followed by its alternative qualities (`alt_documents`),
 * in the order `GET /user/file?quality=<index>` addresses them. The thread
 * DTO (`dto-video.ts`) and the streaming engine (`media.ts`) share this one
 * vector so the index the client sends is the variant the engine serves:
 *
 * - an alt that is not a video document is dropped *before* indexing, never
 *   left as a gap. Telegram's `alt_documents` also carries HLS manifests and
 *   video storyboards/maps, which are not qualities and have no video
 *   attributes;
 * - variants that repeat a resolution are collapsed to one, because Telegram
 *   transcodes the same size in several codecs and the selector names a
 *   quality by its resolution;
 * - the primary stays at index 0, and the alternatives are ordered from the
 *   highest resolution down.
 */
export function variantDocuments(media: { raw: tl.RawDocument; media?: tl.RawMessageMediaDocument }): tl.RawDocument[] {
  const seen = new Set<number>();
  const primaryHeight = videoAttribute(media.raw)?.h;
  if (primaryHeight !== undefined) seen.add(primaryHeight);
  const alts = (media.media?.altDocuments ?? [])
    .filter((document): document is tl.RawDocument => document._ === 'document' && isVideoVariant(document))
    .toSorted(compareQuality)
    .filter((document) => {
      const height = videoAttribute(document)?.h;
      if (height === undefined || seen.has(height)) return false;
      seen.add(height);
      return true;
    });
  return [media.raw, ...alts];
}

function isVideoVariant(document: tl.RawDocument): boolean {
  return !NON_VIDEO_ALT_MIMES.has(document.mimeType) && videoAttribute(document) !== undefined;
}

function videoAttribute(document: tl.RawDocument): tl.RawDocumentAttributeVideo | undefined {
  return document.attributes.find((attribute): attribute is tl.RawDocumentAttributeVideo => attribute._ === 'documentAttributeVideo');
}

/**
 * Highest resolution first. A tie prefers a broadly playable codec over an
 * HEVC/unknown one, since collapsing a resolution drops the alternatives.
 */
function compareQuality(left: tl.RawDocument, right: tl.RawDocument): number {
  const leftVideo = videoAttribute(left);
  const rightVideo = videoAttribute(right);
  return (
    (rightVideo?.h ?? 0) - (leftVideo?.h ?? 0) || (rightVideo?.w ?? 0) - (leftVideo?.w ?? 0) || codecRank(leftVideo) - codecRank(rightVideo)
  );
}

function codecRank(video: tl.RawDocumentAttributeVideo | undefined): number {
  const codec = video?.videoCodec?.toLowerCase();
  if (!codec || codec === 'h264' || codec === 'avc1') return 0;
  if (codec === 'av1' || codec === 'av01' || codec === 'vp9') return 1;
  return 2;
}
