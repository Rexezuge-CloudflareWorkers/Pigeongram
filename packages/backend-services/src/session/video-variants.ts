import type { tl } from '@mtcute/core';

/**
 * The plain TL document behind one streamable video variant: Telegram's
 * primary document followed by its alternative qualities (`alt_documents`),
 * in the order `GET /user/file?quality=<index>` addresses them. The
 * thread DTO (`dto-video.ts`) and the streaming engine (`media.ts`) share
 * this one vector so the index the client sends is the variant the engine
 * serves: an alt that is not a document is dropped *before* indexing, never
 * left as a gap.
 */
export function variantDocuments(media: { raw: tl.RawDocument; media?: tl.RawMessageMediaDocument }): tl.RawDocument[] {
  const alts = (media.media?.altDocuments ?? []).filter((document): document is tl.RawDocument => document._ === 'document');
  return [media.raw, ...alts];
}
