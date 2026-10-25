import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageMedia } from '../../apps/web/src/components/Media';
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
    text: '',
    entities: [],
    reactions: [],
    service: false,
    media,
    poll: null,
    markup: null,
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

describe('document links', () => {
  it('marks a file attachment as a download with the icon before its name', () => {
    const media: MessageMediaDto = { ...sticker, kind: 'document', fileName: 'notes.pdf', mime: 'application/pdf', size: 3072 };
    const { container } = render(<MessageMedia message={message(media)} media={media} onOpen={() => {}} />);

    const link = container.querySelector('a.document');
    expect(link?.getAttribute('href')).toBe('/user/file?chatId=2&messageId=10');
    expect(link?.getAttribute('download')).toBe('notes.pdf');
    const icon = link?.querySelector('svg[data-icon="download"]');
    expect(icon).not.toBeNull();
    expect(link?.firstElementChild).toBe(icon);
    expect(link?.querySelector('.doc-name')?.textContent).toBe('notes.pdf');
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
