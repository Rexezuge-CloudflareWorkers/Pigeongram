import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaViewer } from '../../pages/src/components/MediaViewer';
import type { MessageDto, MessageMediaDto } from '../../pages/src/types';

afterEach(cleanup);

function message(id: number, media: MessageMediaDto): MessageDto {
  return {
    id,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
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

function photo(id: number): MessageDto {
  return message(id, {
    kind: 'photo',
    fileName: `photo-${id}.jpg`,
    mime: 'image/jpeg',
    size: 2048,
    width: 1200,
    height: 800,
    duration: null,
  });
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
    expect(button('Reset zoom').disabled).toBe(true);

    fireEvent.doubleClick(image);
    expect(scaleOf(image)).toBe(2);
    expect(button('Reset zoom').disabled).toBe(false);

    fireEvent.doubleClick(image);
    expect(scaleOf(image)).toBe(1);
  });

  it('steps the toolbar between reset states and disables at the limits', () => {
    const image = renderViewer([photo(1)]);
    const zoomIn = button('Zoom in');
    const zoomOut = button('Zoom out');
    expect(zoomOut.disabled).toBe(true);

    fireEvent.click(zoomIn);
    expect(scaleOf(image)).toBe(1.5);
    fireEvent.click(zoomIn);
    expect(scaleOf(image)).toBe(2);

    fireEvent.click(zoomOut);
    expect(scaleOf(image)).toBe(1.5);
    fireEvent.click(button('Reset zoom'));
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

    fireEvent.click(button('Next media'));
    const second = screen.getByRole('img');
    expect(scaleOf(second)).toBe(1);
    expect(button('Reset zoom').disabled).toBe(true);
  });

  it('leaves videos on their native controls', () => {
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
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  });
});
