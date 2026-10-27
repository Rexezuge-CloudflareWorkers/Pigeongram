import type { MessageMedia, Photo, WebPageMedia } from '@mtcute/core';
import type { MessageWebPageDto } from '../types';

/**
 * Link previews (Telegram's `messageMediaWebPage`).
 *
 * A preview has no message file of its own: `media` stays null on the wire and
 * the card rides beside it as `webPage`. The page's photo is a normal Telegram
 * photo, so `/user/file` serves it from the message — the browser never
 * fetches the linked page or its image.
 */

/**
 * Maps a message's web page media onto the wire shape, or null when the
 * message is not a link preview.
 *
 * Telegram may carry a preview whose URL is not a web URL, or whose photo has
 * no downloadable size. Both degrade to a text-only message rather than
 * failing the whole window: the message's own text is still worth showing.
 */
export function toMessageWebPageDto(media: MessageMedia): MessageWebPageDto | null {
  if (media?.type !== 'webpage') return null;
  try {
    const page = media.preview;
    // The card is an external link; a `tg://` or `javascript:` preview has no
    // safe browser target and stays text-only.
    if (!/^https?:\/\//i.test(page.url)) return null;
    const photo = webPagePhoto(media);
    return {
      url: page.url,
      displayUrl: page.displayUrl,
      siteName: page.siteName,
      title: page.title,
      description: page.description || page.author || null,
      displaySize: media.displaySize,
      photo: photo ? { id: photo.id.toString(), width: photo.width, height: photo.height } : null,
    };
  } catch {
    // A malformed preview must not take the message down with it.
    return null;
  }
}

/**
 * The downloadable photo inside a web page preview, or null when Telegram sent
 * none.
 *
 * mtcute's `Photo` constructor throws when the preview carries only a stripped
 * thumbnail (no `photoSize` to download), so the getter needs a guard here
 * rather than at every call site.
 */
export function webPagePhoto(media: WebPageMedia): Photo | null {
  try {
    return media.preview.photo;
  } catch {
    return null;
  }
}
