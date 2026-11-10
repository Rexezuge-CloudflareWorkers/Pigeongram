import type { Document, tl } from '@mtcute/core';
import type { MessageMediaDto } from '../types';

/**
 * The intrinsic size of an image document. Telegram puts it in the document's
 * image-size attribute, which is what lets the SPA reserve the inline preview's
 * box before the bytes arrive. Non-image documents carry no such attribute.
 */
export function documentDimensions(media: Document): Pick<MessageMediaDto, 'width' | 'height'> {
  const image = media.raw.attributes.find(
    (attribute): attribute is tl.RawDocumentAttributeImageSize => attribute._ === 'documentAttributeImageSize',
  );
  return { width: image?.w ?? null, height: image?.h ?? null };
}
