import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageAlbum, MessageMedia } from '../../apps/web/src/components/Media';
import { DEFAULT_DATA_SAVER, DataSaverProvider } from '../../apps/web/src/data-saver';
import type { MessageDto, MessageMediaDto } from '../../apps/web/src/types';

const lottie = vi.hoisted(() => ({
  loadAnimation: vi.fn(() => ({ destroy: vi.fn(), goToAndStop: vi.fn() })),
}));

vi.mock('lottie-web/build/player/lottie_light', () => ({
  default: { loadAnimation: lottie.loadAnimation },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  lottie.loadAnimation.mockClear();
});

const sticker: MessageMediaDto = {
  kind: 'sticker',
  fileName: 'sticker.webm',
  mime: 'video/webm',
  size: 2048,
  width: 512,
  height: 512,
  duration: null,
};

function message(media: MessageMediaDto): MessageDto {
  return {
    id: 10,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    editDate: null,
    text: '',
    entities: [],
    reactions: [],
    service: false,
    media,
    webPage: null,
    poll: null,
    markup: null,
    replyKeyboard: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  };
}

function renderSticker(media: MessageMediaDto): HTMLElement {
  const { container } = render(<MessageMedia message={message(media)} media={media} onOpen={() => {}} />);
  return container;
}

function renderWithSettings(media: MessageMediaDto, settings: typeof DEFAULT_DATA_SAVER, onOpen: () => void = () => {}): HTMLElement {
  const { container } = render(
    <DataSaverProvider value={{ settings, setSetting: () => {} }}>
      <MessageMedia message={message(media)} media={media} onOpen={onOpen} />
    </DataSaverProvider>,
  );
  return container;
}

describe('document links', () => {
  it('marks a file attachment as a download with the icon before its name', () => {
    const media: MessageMediaDto = { ...sticker, kind: 'document', fileName: 'notes.pdf', mime: 'application/pdf', size: 3072 };
    const { container } = render(<MessageMedia message={message(media)} media={media} onOpen={() => {}} />);

    const link = container.querySelector('a.document');
    expect(link?.getAttribute('href')).toBe('/user/file?chatId=2&messageId=10&quality=max&download=1');
    expect(link?.getAttribute('download')).toBe('notes.pdf');
    const icon = link?.querySelector('svg[data-icon="download"]');
    expect(icon).not.toBeNull();
    expect(link?.firstElementChild).toBe(icon);
    expect(link?.querySelector('.doc-name')?.textContent).toBe('notes.pdf');
  });
});

describe('image document previews', () => {
  const image: MessageMediaDto = {
    ...sticker,
    kind: 'document',
    fileName: 'photo.jpg',
    mime: 'image/jpeg',
    size: 3072,
    width: 640,
    height: 480,
  };

  it('renders an image document inline and opens it in the viewer', () => {
    const onOpen = vi.fn();
    const { container } = render(<MessageMedia message={message(image)} media={image} onOpen={onOpen} />);

    const preview = container.querySelector('button.document-image');
    expect(preview).not.toBeNull();
    expect(container.querySelector('a.document')).toBeNull();
    const img = preview?.querySelector('img.photo');
    expect(img?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10&thumb=1');
    expect(img?.getAttribute('width')).toBe('640');
    expect(img?.getAttribute('height')).toBe('480');
    expect(preview?.getAttribute('aria-label')).toBe('Open photo.jpg');

    fireEvent.click(preview!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('uses the original image for a GIF so it still animates', () => {
    const gif = { ...image, fileName: 'loop.gif', mime: 'image/gif' };
    const { container } = render(<MessageMedia message={message(gif)} media={gif} onOpen={() => {}} />);

    expect(container.querySelector('img.photo')?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10');
  });

  it('falls back through the original and then the download link', () => {
    const { container } = render(<MessageMedia message={message(image)} media={image} onOpen={() => {}} />);

    fireEvent.error(container.querySelector('img.photo')!);
    expect(container.querySelector('img.photo')?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10');

    fireEvent.error(container.querySelector('img.photo')!);
    expect(container.querySelector('img.photo')).toBeNull();
    expect(container.querySelector('a.document')).not.toBeNull();
  });

  it('keeps an SVG document as a download link', () => {
    const svg = { ...image, fileName: 'logo.svg', mime: 'image/svg+xml' };
    const { container } = render(<MessageMedia message={message(svg)} media={svg} onOpen={() => {}} />);

    expect(container.querySelector('img.photo')).toBeNull();
    expect(container.querySelector('a.document')).not.toBeNull();
  });
});

describe('sticker previews', () => {
  it('keeps a static WebP sticker an image', () => {
    const container = renderSticker({ ...sticker, fileName: 'sticker.webp', mime: 'image/webp' });
    const image = container.querySelector('img.sticker');
    expect(image?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10');
    expect(container.querySelector('.document')).toBeNull();
  });

  it('plays a video sticker inline instead of linking the download', () => {
    const container = renderSticker(sticker);
    const video = container.querySelector('video.sticker');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('autoplay')).toBe(true);
    expect(video?.hasAttribute('loop')).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
    expect(video?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10');
    expect(container.querySelector('.document')).toBeNull();
  });

  it('falls back to the thumbnail when a video sticker cannot play', () => {
    const container = renderSticker(sticker);
    fireEvent.error(container.querySelector('video.sticker')!);
    const thumbnail = container.querySelector(':scope a.sticker-link img.sticker');
    expect(thumbnail?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10&thumb=1');
    expect(container.querySelector('.document')).toBeNull();
  });

  it('decompresses an animated sticker and hands it to the Lottie player', async () => {
    const animationData = { v: '5.7.4', w: 512, h: 512, fr: 30, ip: 0, op: 30, layers: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(gzipSync(JSON.stringify(animationData)))),
    );

    const container = renderSticker({ ...sticker, fileName: 'AnimatedSticker.tgs', mime: 'application/x-tgsticker' });

    await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalledTimes(1));
    expect(lottie.loadAnimation).toHaveBeenCalledWith(expect.objectContaining({ animationData, autoplay: true }));
    expect(container.querySelector('.sticker-lottie')).not.toBeNull();
    expect(container.querySelector('.document')).toBeNull();
  });

  it('falls back to the thumbnail when an animated sticker cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    const container = renderSticker({ ...sticker, fileName: 'AnimatedSticker.tgs', mime: 'application/x-tgsticker' });

    await waitFor(() => expect(container.querySelector(':scope a.sticker-link img.sticker')).not.toBeNull());
    expect(lottie.loadAnimation).not.toHaveBeenCalled();
  });

  it('shows the document link when even the thumbnail is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    const container = renderSticker({ ...sticker, fileName: 'AnimatedSticker.tgs', mime: 'application/x-tgsticker' });
    await waitFor(() => expect(container.querySelector(':scope a.sticker-link img.sticker')).not.toBeNull());
    fireEvent.error(container.querySelector(':scope a.sticker-link img.sticker')!);

    const document = container.querySelector('.document');
    expect(document?.getAttribute('download')).toBe('AnimatedSticker.tgs');
  });
});

describe('data saver', () => {
  const photo: MessageMediaDto = {
    ...sticker,
    kind: 'photo',
    fileName: 'photo.jpg',
    mime: 'image/jpeg',
    width: 640,
    height: 480,
  };
  const animation: MessageMediaDto = {
    ...sticker,
    kind: 'animation',
    fileName: 'loop.mp4',
    mime: 'video/mp4',
    width: 320,
    height: 180,
  };

  it('leaves a photo unfetched until it is loaded', () => {
    const container = renderWithSettings(photo, { ...DEFAULT_DATA_SAVER, loadMedia: false });

    expect(container.querySelector('img')).toBeNull();
    const placeholder = container.querySelector('button.media-placeholder');
    expect(placeholder?.getAttribute('aria-label')).toBe('Load photo.jpg');
    expect(placeholder?.textContent).toBe('Tap To Load');
    expect(placeholder?.getAttribute('style')).toContain('aspect-ratio: 640 / 480');
  });

  it('loads a photo preview on the first tap and opens the viewer on the second', () => {
    const onOpen = vi.fn();
    const container = renderWithSettings(photo, { ...DEFAULT_DATA_SAVER, loadMedia: false }, onOpen);

    fireEvent.click(container.querySelector('button.media-placeholder')!);
    expect(onOpen).not.toHaveBeenCalled();

    const image = container.querySelector(':scope button.media-open img.photo');
    expect(image?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10&thumb=1');

    fireEvent.click(container.querySelector('button.media-open')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders a loaded photo bubble from its thumbnail', () => {
    const container = renderWithSettings(photo, DEFAULT_DATA_SAVER);

    expect(container.querySelector('img.photo')?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10&thumb=1');
  });

  it('falls back from a photo thumbnail to the original and then the download link', () => {
    const container = renderWithSettings(photo, DEFAULT_DATA_SAVER);

    fireEvent.error(container.querySelector('img.photo')!);
    expect(container.querySelector('img.photo')?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10');

    fireEvent.error(container.querySelector('img.photo')!);
    expect(container.querySelector('img.photo')).toBeNull();
    expect(container.querySelector('a.document')).not.toBeNull();
  });

  it('loads a video poster on the first tap and opens the viewer on the second', () => {
    const video: MessageMediaDto = { ...photo, kind: 'video', fileName: 'clip.mp4' };
    const onOpen = vi.fn();
    const container = renderWithSettings(video, { ...DEFAULT_DATA_SAVER, loadMedia: false }, onOpen);

    fireEvent.click(container.querySelector('button.media-placeholder')!);
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector(':scope button.video-tile img')?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10&thumb=1');

    fireEvent.click(container.querySelector('button.video-tile')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('loads an album cell on the first tap and opens the viewer on the second', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <DataSaverProvider value={{ settings: { ...DEFAULT_DATA_SAVER, loadMedia: false }, setSetting: () => {} }}>
        <MessageAlbum messages={[message(photo)]} onOpenMedia={onOpen} />
      </DataSaverProvider>,
    );

    const cell = container.querySelector('button.cell');
    expect(cell?.getAttribute('aria-label')).toBe('Load photo.jpg');
    expect(container.querySelector(':scope button.cell img')).toBeNull();

    fireEvent.click(cell!);
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector(':scope button.cell img')?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10&thumb=1');
    expect(cell?.getAttribute('aria-label')).toBe('Open photo.jpg');

    fireEvent.click(cell!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('loads an image document preview before opening it', () => {
    const image: MessageMediaDto = { ...photo, kind: 'document', fileName: 'photo.jpg' };
    const onOpen = vi.fn();
    const container = renderWithSettings(image, { ...DEFAULT_DATA_SAVER, loadMedia: false }, onOpen);

    fireEvent.click(container.querySelector('button.media-placeholder')!);
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector(':scope button.document-image img.photo')?.getAttribute('src')).toBe(
      '/user/file?chatId=2&messageId=10&thumb=1',
    );

    fireEvent.click(container.querySelector('button.document-image')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('leaves a video poster unfetched too', () => {
    const video: MessageMediaDto = { ...photo, kind: 'video', fileName: 'clip.mp4' };
    const container = renderWithSettings(video, { ...DEFAULT_DATA_SAVER, loadMedia: false });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('button.media-placeholder')).not.toBeNull();
  });

  it('keeps a GIF as a still poster when autoplay is off', () => {
    const container = renderWithSettings(animation, { ...DEFAULT_DATA_SAVER, animateMedia: false });

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10&thumb=1');
    expect(container.querySelector('.play')).not.toBeNull();
  });

  it('leaves an image document unfetched when media loading is off', () => {
    const image: MessageMediaDto = { ...photo, kind: 'document', fileName: 'photo.jpg' };
    const container = renderWithSettings(image, { ...DEFAULT_DATA_SAVER, loadMedia: false });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a.document')).toBeNull();
    expect(container.querySelector('button.media-placeholder')?.getAttribute('aria-label')).toBe('Load photo.jpg');
  });

  it('keeps a video sticker as its still thumbnail when autoplay is off', () => {
    const container = renderWithSettings(sticker, { ...DEFAULT_DATA_SAVER, animateMedia: false });

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector(':scope a.sticker-link img.sticker')?.getAttribute('src')).toBe(
      '/user/file?chatId=2&messageId=10&thumb=1',
    );
  });

  it('does not fetch an animated sticker when autoplay is off', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);

    const container = renderWithSettings(
      { ...sticker, fileName: 'AnimatedSticker.tgs', mime: 'application/x-tgsticker' },
      { ...DEFAULT_DATA_SAVER, animateMedia: false },
    );

    expect(request).not.toHaveBeenCalled();
    expect(container.querySelector('.sticker-lottie')).toBeNull();
    expect(container.querySelector(':scope a.sticker-link img.sticker')).not.toBeNull();
  });
});

describe('thumbnail loading', () => {
  const photo: MessageMediaDto = {
    ...sticker,
    kind: 'photo',
    fileName: 'photo.jpg',
    mime: 'image/jpeg',
    width: 640,
    height: 480,
  };

  it('reserves the media box and shows a skeleton until the thumbnail lands', () => {
    const { container } = render(<MessageMedia message={message(photo)} media={photo} onOpen={() => {}} />);

    const thumb = container.querySelector('.media-thumb');
    expect(thumb?.classList.contains('is-loading')).toBe(true);
    expect(container.querySelector('.media-thumb-skeleton')).not.toBeNull();

    fireEvent.load(container.querySelector('img.photo')!);

    expect(container.querySelector('.media-thumb-skeleton')).toBeNull();
    expect(thumb?.classList.contains('is-loaded')).toBe(true);
  });

  it('falls back to a preview box when Telegram reported no dimensions', () => {
    const unsized: MessageMediaDto = { ...photo, width: null, height: null };
    const { container } = render(<MessageMedia message={message(unsized)} media={unsized} onOpen={() => {}} />);

    const style = container.querySelector('.media-thumb.is-fallback')?.getAttribute('style') ?? '';
    expect(style).toContain('width: min(280px, 100%)');
    expect(style).toContain('aspect-ratio: 4 / 3');
    expect(container.querySelector('.media-thumb-skeleton')).not.toBeNull();
  });

  it('brings the skeleton back when a failed thumbnail swaps to the original', () => {
    const { container } = render(<MessageMedia message={message(photo)} media={photo} onOpen={() => {}} />);
    fireEvent.load(container.querySelector('img.photo')!);
    expect(container.querySelector('.media-thumb-skeleton')).toBeNull();

    fireEvent.error(container.querySelector('img.photo')!);

    expect(container.querySelector('img.photo')?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10');
    expect(container.querySelector('.media-thumb-skeleton')).not.toBeNull();
  });

  it('shows a skeleton in an album cell until its thumbnail loads', () => {
    const { container } = render(<MessageAlbum messages={[message(photo)]} onOpenMedia={() => {}} />);

    expect(container.querySelector(':scope .cell .media-thumb-skeleton')).not.toBeNull();
    fireEvent.load(container.querySelector(':scope .cell img')!);
    expect(container.querySelector(':scope .cell .media-thumb-skeleton')).toBeNull();
  });

  it('shows a poster skeleton for a video thumbnail', () => {
    const video: MessageMediaDto = { ...photo, kind: 'video', fileName: 'clip.mp4' };
    const { container } = render(<MessageMedia message={message(video)} media={video} onOpen={() => {}} />);

    expect(container.querySelector(':scope .video-tile .media-thumb-skeleton')).not.toBeNull();
    fireEvent.load(container.querySelector(':scope .video-tile img')!);
    expect(container.querySelector(':scope .video-tile .media-thumb-skeleton')).toBeNull();
  });
});
