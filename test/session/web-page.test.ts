import { Long, WebPageMedia } from '@mtcute/core';
import type { MessageMedia, tl } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { toMessageWebPageDto, webPagePhoto } from '../../packages/backend-services/src/session/web-page';

/**
 * Link previews: what a `messageMediaWebPage` puts on the wire, and what it
 * leaves out. The card is Telegram's copy of the page, so the mapper is also
 * where an unsafe URL and a photo-less preview are turned away.
 */

const PHOTO_ID = Long.fromNumber(1234);

const photoSize = { _: 'photoSize', type: 'x', w: 320, h: 200, size: 2048 };

function rawPhoto(overrides: Record<string, unknown> = {}): tl.RawPhoto {
  return {
    _: 'photo',
    id: PHOTO_ID,
    accessHash: Long.fromNumber(5678),
    fileReference: new Uint8Array([1, 2, 3]),
    date: 1_700_000_000,
    dcId: 2,
    sizes: [photoSize],
    ...overrides,
  } as unknown as tl.RawPhoto;
}

/**
 * A `WebPageMedia` over a raw web page, with the page fields and the media
 * flags overridable.
 */
function webpage(page: Record<string, unknown> = {}, media: Record<string, unknown> = {}): WebPageMedia {
  const raw = {
    _: 'messageMediaWebPage',
    webpage: {
      _: 'webPage',
      id: Long.fromNumber(42),
      url: 'https://example.com/article',
      displayUrl: 'example.com/article',
      hash: 0,
      type: 'article',
      siteName: 'Example',
      title: 'An article',
      description: 'A description',
      photo: rawPhoto(),
      ...page,
    },
    ...media,
  } as unknown as tl.RawMessageMediaWebPage;
  return new WebPageMedia(raw);
}

describe('toMessageWebPageDto', () => {
  it('maps the page and its photo', () => {
    expect(toMessageWebPageDto(webpage())).toEqual({
      url: 'https://example.com/article',
      displayUrl: 'example.com/article',
      siteName: 'Example',
      title: 'An article',
      description: 'A description',
      displaySize: 'default',
      photo: { id: '1234', width: 320, height: 200 },
    });
  });

  it("carries Telegram's layout hint", () => {
    expect(toMessageWebPageDto(webpage({}, { forceSmallMedia: true }))?.displaySize).toBe('small');
    expect(toMessageWebPageDto(webpage({}, { forceLargeMedia: true }))?.displaySize).toBe('large');
    expect(toMessageWebPageDto(webpage())?.displaySize).toBe('default');
  });

  it('falls back to the author when the description is missing', () => {
    const dto = toMessageWebPageDto(webpage({ description: undefined, author: 'Ada Lovelace' }));
    expect(dto?.description).toBe('Ada Lovelace');
  });

  it('leaves the description null when Telegram sent neither', () => {
    expect(toMessageWebPageDto(webpage({ description: undefined }))?.description).toBeNull();
  });

  it('keeps a page without a photo as a text card', () => {
    const dto = toMessageWebPageDto(webpage({ photo: undefined }));
    expect(dto?.photo).toBeNull();
    expect(dto?.title).toBe('An article');
  });

  it('treats a stripped-only photo as no photo', () => {
    // The `Photo` constructor throws when there is no downloadable size; the
    // preview still renders, just without an image.
    const dto = toMessageWebPageDto(
      webpage({ photo: rawPhoto({ sizes: [{ _: 'photoStrippedSize', type: 'i', bytes: new Uint8Array([1]) }] }) }),
    );
    expect(dto?.photo).toBeNull();
  });

  it('refuses a preview that does not point at the web', () => {
    expect(toMessageWebPageDto(webpage({ url: 'tg://resolve?domain=telegram' }))).toBeNull();
    expect(toMessageWebPageDto(webpage({ url: 'javascript:alert(1)' }))).toBeNull();
  });

  it('returns null for messages that are not link previews', () => {
    expect(toMessageWebPageDto(null)).toBeNull();
    expect(toMessageWebPageDto({ type: 'photo' } as MessageMedia)).toBeNull();
  });
});

describe('webPagePhoto', () => {
  it('returns the preview photo', () => {
    expect(webPagePhoto(webpage())?.id.toString()).toBe('1234');
  });

  it('returns null instead of throwing for a stripped-only photo', () => {
    const media = webpage({ photo: rawPhoto({ sizes: [{ _: 'photoStrippedSize', type: 'i', bytes: new Uint8Array([1]) }] }) });
    expect(webPagePhoto(media)).toBeNull();
  });
});
