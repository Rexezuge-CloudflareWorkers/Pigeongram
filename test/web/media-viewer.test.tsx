import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaViewer } from '../../apps/web/src/components/MediaViewer';
import type { MessageDto, MessageMediaDto } from '../../apps/web/src/types';

afterEach(cleanup);

function message(id: number, media: MessageMediaDto): MessageDto {
  return {
    id,
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

function photo(id: number): MessageDto {
  return message(id, {
    kind: 'photo',
    fileName: null,
    mime: null,
    size: 2048,
    width: 1200,
    height: 800,
    duration: null,
  });
}

function imageDocument(id: number): MessageDto {
  return message(id, {
    kind: 'document',
    fileName: 'photo.jpg',
    mime: 'image/jpeg',
    size: 4096,
    width: 1200,
    height: 800,
    duration: null,
  });
}

function video(id: number, kind: 'video' | 'animation' = 'video'): MessageDto {
  return message(id, {
    kind,
    fileName: kind === 'video' ? 'clip.mp4' : null,
    mime: kind === 'video' ? 'video/mp4' : null,
    size: 4096,
    width: 1280,
    height: 720,
    duration: 4,
  });
}

/**
 * A touch drag across `target`, from a fixed point. The viewer's stage owns
 * the handlers, so any element in it can start the gesture.
 */
function swipe(target: Element, dx: number, dy = 0, startX = 300, startY = 300): void {
  const init = { pointerId: 1, pointerType: 'touch', clientX: startX, clientY: startY };
  fireEvent.pointerDown(target, init);
  fireEvent.pointerMove(target, { ...init, clientX: startX + dx, clientY: startY + dy });
  fireEvent.pointerUp(target, { ...init, clientX: startX + dx, clientY: startY + dy });
}

function currentImageSrc(): string | null {
  return screen.getByRole('img').getAttribute('src');
}

function counterText(): string | null {
  return document.querySelector('.media-viewer-count')?.textContent ?? null;
}

function renderViewer(
  messages: readonly MessageDto[],
  initialMessageId = messages[0]?.id ?? 0,
  onClose: () => void = () => {},
): HTMLElement {
  render(<MediaViewer messages={messages} initialMessageId={initialMessageId} onClose={onClose} />);
  const image = document.querySelector<HTMLImageElement>('img.media-viewer-photo');
  if (image === null) throw new Error('the viewer rendered no photo');
  return image;
}

function scaleOf(image: HTMLElement): number {
  const match = /scale\(([\d.]+)\)/.exec(image.style.transform);
  return Number(match?.[1] ?? 0);
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('media viewer photo zoom', () => {
  it('toggles between 1x and 2x on double click', () => {
    const image = renderViewer([photo(1)]);
    expect(scaleOf(image)).toBe(1);
    expect(button('Reset Zoom').disabled).toBe(true);

    fireEvent.doubleClick(image);
    expect(scaleOf(image)).toBe(2);
    expect(button('Reset Zoom').disabled).toBe(false);

    fireEvent.doubleClick(image);
    expect(scaleOf(image)).toBe(1);
  });

  it('treats an image sent as a document as a zoomable photo', () => {
    const image = renderViewer([imageDocument(1)]);
    expect(image.getAttribute('src')).toBe('/user/file?chatId=2&messageId=1');
    expect(scaleOf(image)).toBe(1);

    fireEvent.doubleClick(image);
    expect(scaleOf(image)).toBe(2);
  });

  it('steps the toolbar between reset states and disables at the limits', () => {
    const image = renderViewer([photo(1)]);
    const zoomIn = button('Zoom In');
    const zoomOut = button('Zoom Out');
    expect(zoomOut.disabled).toBe(true);

    fireEvent.click(zoomIn);
    expect(scaleOf(image)).toBe(1.5);
    fireEvent.click(zoomIn);
    expect(scaleOf(image)).toBe(2);

    fireEvent.click(zoomOut);
    expect(scaleOf(image)).toBe(1.5);
    fireEvent.click(button('Reset Zoom'));
    expect(scaleOf(image)).toBe(1);

    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);
    expect(scaleOf(image)).toBe(4);
    expect(zoomIn.disabled).toBe(true);
  });

  it('zooms with the wheel and returns to 1x when zooming out', () => {
    const image = renderViewer([photo(1)]);
    fireEvent.wheel(image, { deltaY: -400, clientX: 100, clientY: 100 });
    expect(scaleOf(image)).toBeGreaterThan(1);

    fireEvent.wheel(image, { deltaY: 2000, clientX: 100, clientY: 100 });
    expect(scaleOf(image)).toBe(1);
  });

  it('zooms with a touch pinch', () => {
    const image = renderViewer([photo(1)]);
    fireEvent.pointerDown(image, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerDown(image, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 });
    fireEvent.pointerMove(image, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 });

    expect(scaleOf(image)).toBe(2);
  });

  it('zooms with a touch double tap', () => {
    const image = renderViewer([photo(1)]);
    const tap = (): void => {
      fireEvent.pointerDown(image, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 90 });
      fireEvent.pointerUp(image, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 90 });
    };

    tap();
    tap();
    expect(scaleOf(image)).toBe(2);
  });

  it('does not close the viewer when a pan ends over the backdrop', () => {
    const onClose = vi.fn();
    const image = renderViewer([photo(1)], 1, onClose);
    fireEvent.doubleClick(image);
    fireEvent.pointerDown(image, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(image, { pointerId: 1, pointerType: 'mouse', clientX: 140, clientY: 120 });
    fireEvent.pointerUp(image, { pointerId: 1, pointerType: 'mouse', clientX: 140, clientY: 120 });

    const stage = document.querySelector('.media-viewer-stage');
    if (stage === null) throw new Error('the viewer rendered no stage');
    fireEvent.click(stage);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(stage);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the zoom when the gallery moves to another photo', () => {
    const first = renderViewer([photo(1), photo(2)]);
    fireEvent.doubleClick(first);
    expect(scaleOf(first)).toBe(2);

    fireEvent.click(button('Next Media'));
    const second = screen.getByRole('img');
    expect(scaleOf(second)).toBe(1);
    expect(button('Reset Zoom').disabled).toBe(true);
  });

  it('leaves videos on their native controls and downloads the maximum quality', () => {
    render(
      <MediaViewer
        messages={[
          message(1, {
            kind: 'video',
            fileName: 'clip.mp4',
            mime: 'video/mp4',
            size: 4096,
            width: 1280,
            height: 720,
            duration: 4,
          }),
        ]}
        initialMessageId={1}
        onClose={() => {}}
      />,
    );

    expect(document.querySelector('video.media-viewer-media')).not.toBeNull();
    expect(document.querySelector('img.media-viewer-photo')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom In' })).toBeNull();
    const link = screen.getByRole('link', { name: 'Download Original' });
    expect(link.getAttribute('href')).toBe('/user/file?chatId=2&messageId=1&quality=max&download=1');
    expect(link.getAttribute('download')).toBe('clip.mp4');
  });
});

describe('media viewer downloads', () => {
  it('offers the original photo at maximum quality under a generated name', () => {
    renderViewer([photo(7)]);

    const link = screen.getByRole('link', { name: 'Download Original' });
    expect(link.getAttribute('href')).toBe('/user/file?chatId=2&messageId=7&quality=max&download=1');
    expect(link.getAttribute('href')).not.toContain('thumb=1');
    expect(link.getAttribute('download')).toBe('photo-7.jpg');
    expect(link.querySelector('svg[data-icon="download"]')).not.toBeNull();
  });

  it('downloads an image document under its own name', () => {
    renderViewer([imageDocument(7)]);

    const link = screen.getByRole('link', { name: 'Download Original' });
    expect(link.getAttribute('href')).toBe('/user/file?chatId=2&messageId=7&quality=max&download=1');
    expect(link.getAttribute('download')).toBe('photo.jpg');
  });

  it('follows the gallery to the item on screen', () => {
    renderViewer([photo(1), photo(2)]);
    fireEvent.click(button('Next Media'));

    const link = screen.getByRole('link', { name: 'Download Original' });
    expect(link.getAttribute('href')).toBe('/user/file?chatId=2&messageId=2&quality=max&download=1');
    expect(link.getAttribute('download')).toBe('photo-2.jpg');
  });

  it('names the failed-preview fallback with the same generated name', () => {
    const image = renderViewer([photo(3)]);
    fireEvent.error(image);

    const fallback = document.querySelector('.media-viewer-fallback');
    expect(fallback?.getAttribute('download')).toBe('photo-3.jpg');
  });
});

describe('media viewer quality', () => {
  function videoWithQualities(id: number): MessageDto {
    return message(id, {
      kind: 'video',
      fileName: 'clip.mp4',
      mime: 'video/mp4',
      size: 4096,
      width: 1280,
      height: 720,
      duration: 4,
      qualities: [
        { index: 0, width: 1280, height: 720, size: 4096, codec: 'avc1' },
        { index: 1, width: 854, height: 480, size: 2048, codec: 'avc1' },
      ],
    });
  }

  it('streams the selected quality and still downloads the maximum quality', () => {
    render(<MediaViewer messages={[videoWithQualities(1)]} initialMessageId={1} onClose={() => {}} />);

    const player = document.querySelector<HTMLVideoElement>('video.media-viewer-media');
    expect(player?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=1');

    const select = screen.getByRole('combobox', { name: 'Video quality' });
    fireEvent.change(select, { target: { value: '1' } });

    expect(document.querySelector<HTMLVideoElement>('video.media-viewer-media')?.getAttribute('src')).toBe(
      '/user/file?chatId=2&messageId=1&quality=1',
    );
    expect(screen.getByRole('link', { name: 'Download Original' }).getAttribute('href')).toBe(
      '/user/file?chatId=2&messageId=1&quality=max&download=1',
    );
  });

  it('does not show a selector when there is only one quality or for animations', () => {
    render(
      <MediaViewer
        messages={[
          message(1, {
            kind: 'video',
            fileName: 'clip.mp4',
            mime: 'video/mp4',
            size: 4096,
            width: 1280,
            height: 720,
            duration: 4,
            qualities: [{ index: 0, width: 1280, height: 720, size: 4096, codec: 'avc1' }],
          }),
          message(2, {
            kind: 'animation',
            fileName: null,
            mime: 'video/mp4',
            size: 1024,
            width: 320,
            height: 240,
            duration: 2,
            qualities: [
              { index: 0, width: 320, height: 240, size: 1024, codec: 'avc1' },
              { index: 1, width: 160, height: 120, size: 512, codec: 'avc1' },
            ],
          }),
        ]}
        initialMessageId={1}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByRole('combobox', { name: 'Video quality' })).toBeNull();
    fireEvent.click(button('Next Media'));
    expect(screen.queryByRole('combobox', { name: 'Video quality' })).toBeNull();
  });
});

describe('media viewer swipe', () => {
  it('swipes left to the next photo and right back to the previous one', () => {
    const image = renderViewer([photo(1), photo(2)]);

    swipe(image, -100);
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=2');
    expect(counterText()).toBe('2 / 2');

    swipe(screen.getByRole('img'), 100);
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=1');
    expect(counterText()).toBe('1 / 2');
  });

  it('follows the finger and settles back before the threshold', () => {
    const image = renderViewer([photo(1), photo(2)]);
    const track = document.querySelector<HTMLElement>('.media-viewer-track');
    if (track === null) throw new Error('the viewer rendered no track');

    fireEvent.pointerDown(image, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 300 });
    fireEvent.pointerMove(image, { pointerId: 1, pointerType: 'touch', clientX: 240, clientY: 306 });
    expect(track.style.transform).toBe('translate3d(-60px, 0, 0)');
    expect(track.classList.contains('is-settling')).toBe(false);

    fireEvent.pointerUp(image, { pointerId: 1, pointerType: 'touch', clientX: 240, clientY: 306 });
    expect(track.style.transform).toBe('translate3d(0px, 0, 0)');
    expect(track.classList.contains('is-settling')).toBe(true);
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=1');
  });

  it('ignores a short or vertical drag', () => {
    const image = renderViewer([photo(1), photo(2)]);

    swipe(image, -40);
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=1');

    swipe(image, 5, -120);
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=1');
  });

  it('resists but does not wrap at either end', () => {
    const image = renderViewer([photo(1), photo(2)]);

    fireEvent.pointerDown(image, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 300 });
    fireEvent.pointerMove(image, { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 300 });
    const track = document.querySelector<HTMLElement>('.media-viewer-track');
    expect(track?.style.transform).toBe('translate3d(25px, 0, 0)');
    fireEvent.pointerUp(image, { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 300 });
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=1');

    fireEvent.click(screen.getByRole('button', { name: 'Next Media' }));
    swipe(screen.getByRole('img'), -100);
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=2');
  });

  it('swipes an animation but leaves a video to its native controls', () => {
    render(<MediaViewer messages={[photo(1), video(2, 'animation')]} initialMessageId={2} onClose={() => {}} />);
    const animation = document.querySelector<HTMLVideoElement>('video.media-viewer-media');
    if (animation === null) throw new Error('the viewer rendered no animation');
    expect(animation.controls).toBe(false);

    swipe(animation, 100);
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=1');

    cleanup();
    render(<MediaViewer messages={[video(1), photo(2)]} initialMessageId={1} onClose={() => {}} />);
    const videoElement = document.querySelector<HTMLVideoElement>('video.media-viewer-media');
    if (videoElement === null) throw new Error('the viewer rendered no video');
    expect(videoElement.controls).toBe(true);

    swipe(videoElement, -100);
    expect(document.querySelector('video.media-viewer-media')).toBe(videoElement);
    expect(counterText()).toBe('1 / 2');
  });

  it('keeps the drag for panning while the photo is zoomed', () => {
    const image = renderViewer([photo(1), photo(2)]);
    fireEvent.doubleClick(image);

    swipe(image, -100);
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=1');
    expect(scaleOf(screen.getByRole('img'))).toBe(2);
  });

  it('does not close the viewer when a swipe ends on the backdrop', () => {
    const onClose = vi.fn();
    render(<MediaViewer messages={[video(1, 'animation'), photo(2)]} initialMessageId={1} onClose={onClose} />);
    const stage = document.querySelector('.media-viewer-stage');
    if (stage === null) throw new Error('the viewer rendered no stage');

    swipe(stage, -40);
    fireEvent.click(stage);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('media viewer keyboard', () => {
  it('zooms and resets a photo from the keyboard', () => {
    const image = renderViewer([photo(1)]);

    fireEvent.keyDown(document, { key: '+' });
    expect(scaleOf(image)).toBe(1.5);

    fireEvent.keyDown(document, { key: '=' });
    expect(scaleOf(image)).toBe(2);

    fireEvent.keyDown(document, { key: '-' });
    expect(scaleOf(image)).toBe(1.5);

    fireEvent.keyDown(document, { key: '_' });
    expect(scaleOf(image)).toBe(1);

    fireEvent.keyDown(document, { key: '+' });
    fireEvent.keyDown(document, { key: '0' });
    expect(scaleOf(image)).toBe(1);
  });

  it('walks the gallery with the arrow keys and ignores modified keys', () => {
    renderViewer([photo(1), photo(2)]);

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=2');

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(currentImageSrc()).toBe('/user/file?chatId=2&messageId=1');

    fireEvent.keyDown(document, { key: '+', metaKey: true });
    expect(button('Reset Zoom').disabled).toBe(true);
  });

  it('leaves the arrow keys to a focused player', () => {
    render(<MediaViewer messages={[video(1), photo(2)]} initialMessageId={1} onClose={() => {}} />);
    const player = document.querySelector<HTMLVideoElement>('video.media-viewer-media');
    if (player === null) throw new Error('the viewer rendered no video');

    fireEvent.keyDown(player, { key: 'ArrowRight' });

    expect(document.querySelector('video.media-viewer-media')).toBe(player);
    expect(counterText()).toBe('1 / 2');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderViewer([photo(1)], 1, onClose);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('media viewer quality labels', () => {
  function videoWith(qualities: Array<{ index: number; width: number | null; height: number | null }>): MessageDto {
    return message(1, {
      kind: 'video',
      fileName: 'clip.mp4',
      mime: 'video/mp4',
      size: 4096,
      width: 1280,
      height: 720,
      duration: 4,
      qualities: qualities.map((quality) => ({ ...quality, size: null, codec: null })),
    });
  }

  it('names a quality by its height, its width, or its position', () => {
    render(
      <MediaViewer
        messages={[
          videoWith([
            { index: 0, width: 1280, height: 720 },
            { index: 1, width: 854, height: null },
            { index: 2, width: null, height: null },
          ]),
        ]}
        initialMessageId={1}
        onClose={() => {}}
      />,
    );

    const options = [...(screen.getByRole('combobox', { name: 'Video quality' }).querySelectorAll('option') ?? [])].map(
      (option) => option.textContent,
    );
    expect(options).toEqual(['Auto', '720p', '854w', 'Quality 3']);
  });

  it('returns to the automatic variant from the selector', () => {
    render(
      <MediaViewer
        messages={[
          videoWith([
            { index: 0, width: 1280, height: 720 },
            { index: 1, width: 854, height: 480 },
          ]),
        ]}
        initialMessageId={1}
        onClose={() => {}}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Video quality' }) as unknown as HTMLSelectElement;

    fireEvent.change(select, { target: { value: '1' } });
    expect(select.value).toBe('1');

    fireEvent.change(select, { target: { value: 'auto' } });
    expect(select.value).toBe('auto');
    expect(document.querySelector<HTMLVideoElement>('video.media-viewer-media')?.getAttribute('src')).toBe(
      '/user/file?chatId=2&messageId=1',
    );
  });
});

describe('media viewer portal guards', () => {
  it('stops the pointer, double-click and context events at its root', () => {
    const seen: string[] = [];
    const record = (event: Event): void => {
      seen.push(event.type);
    };
    document.addEventListener('pointerdown', record);
    document.addEventListener('dblclick', record);
    document.addEventListener('contextmenu', record);

    renderViewer([photo(1)]);
    const viewer = screen.getByRole('dialog', { name: 'Media viewer' });
    fireEvent.pointerDown(viewer);
    fireEvent.doubleClick(viewer);
    fireEvent.contextMenu(viewer);

    expect(seen).toEqual([]);
    document.removeEventListener('pointerdown', record);
    document.removeEventListener('dblclick', record);
    document.removeEventListener('contextmenu', record);
  });

  it('marks an exiting viewer and returns focus to the opener', () => {
    const opener = document.createElement('button');
    // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<MediaViewer messages={[photo(1)]} initialMessageId={1} exiting onClose={() => {}} />);
    expect(document.querySelector('.media-viewer')?.classList.contains('is-exiting')).toBe(true);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
