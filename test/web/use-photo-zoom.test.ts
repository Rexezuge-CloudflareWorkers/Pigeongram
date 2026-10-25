import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePhotoZoom } from '../../apps/web/src/usePhotoZoom';
import type { PhotoZoom } from '../../apps/web/src/usePhotoZoom';

/**
 * The viewer's zoom hook. The math is tested in `photo-zoom.test.ts`; here the
 * pointer, wheel and resize bookkeeping is driven directly, because jsdom has
 * no gesture recogniser and every branch is a gesture window.
 */

interface FakeStage extends HTMLElement {
  wheel: Array<(event: WheelEvent) => void>;
}

function makeStage(): FakeStage {
  const listeners: Array<(event: WheelEvent) => void> = [];
  const stage = {
    wheel: listeners,
    addEventListener: (type: string, listener: (event: WheelEvent) => void) => {
      if (type === 'wheel') listeners.push(listener);
    },
    removeEventListener: (type: string, listener: (event: WheelEvent) => void) => {
      if (type !== 'wheel') return;
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
  } as unknown as FakeStage;
  return stage;
}

function makeImage(): HTMLImageElement {
  return {
    clientWidth: 200,
    clientHeight: 200,
    naturalWidth: 400,
    naturalHeight: 400,
    getAttribute: () => null,
  } as unknown as HTMLImageElement;
}

function setup(options: { enabled?: boolean; mediaId?: number | null } = {}): {
  result: { current: PhotoZoom };
  rerender: (mediaId: number | null) => void;
  stage: FakeStage;
  stageRef: RefObject<HTMLElement | null>;
} {
  const stage = makeStage();
  const stageRef: RefObject<HTMLElement | null> = { current: stage };
  const rendered = renderHook(
    ({ mediaId }: { mediaId: number | null }) => usePhotoZoom({ enabled: options.enabled ?? true, mediaId, stageRef }),
    { initialProps: { mediaId: options.mediaId === undefined ? 1 : options.mediaId } },
  );
  return {
    result: rendered.result as { current: PhotoZoom },
    rerender: (mediaId) => rendered.rerender({ mediaId }),
    stage,
    stageRef,
  };
}

function pointer(
  overrides: {
    pointerId?: number;
    pointerType?: string;
    button?: number;
    clientX?: number;
    clientY?: number;
    target?: EventTarget | null;
  } = {},
): never {
  return {
    pointerId: overrides.pointerId ?? 1,
    pointerType: overrides.pointerType ?? 'touch',
    button: overrides.button ?? 0,
    clientX: overrides.clientX ?? 100,
    clientY: overrides.clientY ?? 100,
    target: overrides.target ?? null,
    currentTarget: { setPointerCapture: () => {}, releasePointerCapture: () => {} },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as never;
}

function mouse(overrides: { target?: EventTarget | null; clientX?: number; clientY?: number } = {}): never {
  return {
    target: overrides.target ?? null,
    clientX: overrides.clientX ?? 100,
    clientY: overrides.clientY ?? 100,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as never;
}

function clickTarget(): EventTarget {
  const button = document.createElement('button');
  return button;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePhotoZoom', () => {
  it('does nothing while zoom is disabled', () => {
    const { result, stage } = setup({ enabled: false });

    act(() => {
      result.current.zoomIn();
      result.current.zoomOut();
      result.current.reset();
      result.current.onLoad();
      result.current.onPointerDown(pointer());
      result.current.onDoubleClick(mouse());
    });

    expect(result.current.style).toEqual({ transform: 'translate3d(0px, 0px, 0) scale(1)' });
    expect(result.current.zoomed).toBe(false);
    expect(stage.wheel).toHaveLength(0);
  });

  it('steps through the zoom stops and reports its state', () => {
    const { result } = setup();

    act(() => result.current.zoomIn());
    expect(result.current.style).toEqual({ transform: 'translate3d(0px, 0px, 0) scale(1.5)' });
    expect(result.current.percent).toBe(150);
    expect(result.current.zoomed).toBe(true);
    expect(result.current.canZoomIn).toBe(true);
    expect(result.current.canZoomOut).toBe(true);

    act(() => result.current.zoomOut());
    expect(result.current.zoomed).toBe(false);
    expect(result.current.canZoomOut).toBe(false);
    expect(result.current.canZoomIn).toBe(true);
  });

  it('resets and forgets the view when the album moves to another item', () => {
    const { result, rerender } = setup();

    act(() => result.current.zoomIn());
    act(() => result.current.reset());
    expect(result.current.percent).toBe(100);

    act(() => result.current.zoomIn());
    rerender(2);
    expect(result.current.percent).toBe(100);
  });

  it('drops a stale view when the hook re-renders with another item', () => {
    const { result, rerender } = setup();

    act(() => result.current.zoomIn());
    rerender(1);
    expect(result.current.percent).toBe(150);
    rerender(3);
    expect(result.current.percent).toBe(100);
  });

  it('drags a zoomed photo and consumes the drag flag once', () => {
    const { result } = setup();
    act(() => result.current.attachImage(makeImage()));
    act(() => result.current.zoomIn());

    act(() => result.current.onPointerDown(pointer({ clientX: 50, clientY: 50 })));
    expect(result.current.panning).toBe(true);

    act(() => result.current.onPointerMove(pointer({ clientX: 70, clientY: 60 })));
    expect(result.current.style.transform).toContain('translate3d(20px, 10px, 0)');

    expect(result.current.consumeDrag()).toBe(true);
    expect(result.current.consumeDrag()).toBe(false);

    act(() => result.current.onPointerUp(pointer({ pointerType: 'mouse' })));
    expect(result.current.panning).toBe(false);
  });

  it('marks a photo panned only when it is zoomed', () => {
    const { result } = setup();

    act(() => result.current.onPointerDown(pointer()));
    expect(result.current.panning).toBe(false);

    act(() => result.current.onPointerMove(pointer({ clientX: 180, clientY: 180 })));
    expect(result.current.style.transform).toContain('scale(1)');
    expect(result.current.consumeDrag()).toBe(true);
  });

  it('ignores a control, a secondary mouse button and an untracked release', () => {
    const { result } = setup();

    act(() => result.current.onPointerDown(pointer({ target: clickTarget() })));
    act(() => result.current.onPointerDown(pointer({ pointerType: 'mouse', button: 2 })));
    act(() => result.current.onPointerMove(pointer({ pointerId: 99 })));
    act(() => result.current.onPointerUp(pointer({ pointerId: 99 })));

    expect(result.current.panning).toBe(false);
    expect(result.current.consumeDrag()).toBe(false);
  });

  it('zooms a double-click and resets the next one', () => {
    const { result } = setup();

    act(() => result.current.onDoubleClick(mouse({ clientX: 100, clientY: 100 })));
    expect(result.current.percent).toBe(200);

    act(() => result.current.onDoubleClick(mouse({ clientX: 100, clientY: 100 })));
    expect(result.current.percent).toBe(100);
  });

  it('ignores a double-click on a control and the synthetic one after a touch pair', () => {
    const { result } = setup();

    act(() => result.current.onDoubleClick(mouse({ target: clickTarget() })));
    expect(result.current.percent).toBe(100);

    // Two touch taps in the same place zoom once, and mark the time so the
    // browser's synthetic dblclick is ignored.
    act(() => result.current.onPointerDown(pointer({ pointerType: 'touch' })));
    act(() => result.current.onPointerUp(pointer({ pointerType: 'touch' })));
    act(() => result.current.onPointerDown(pointer({ pointerType: 'touch' })));
    act(() => result.current.onPointerUp(pointer({ pointerType: 'touch' })));
    expect(result.current.percent).toBe(200);

    act(() => result.current.onDoubleClick(mouse({ clientX: 100, clientY: 100 })));
    expect(result.current.percent).toBe(200);
  });

  it('does not register a tap when the press became a drag or was cancelled', () => {
    const { result } = setup();

    act(() => result.current.onPointerDown(pointer()));
    act(() => result.current.onPointerMove(pointer({ clientX: 150 })));
    act(() => result.current.onPointerUp(pointer()));
    expect(result.current.percent).toBe(100);

    act(() => result.current.onPointerDown(pointer()));
    act(() => result.current.onPointerCancel(pointer()));
    expect(result.current.percent).toBe(100);

    // A long press is not a tap either.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    act(() => result.current.onPointerDown(pointer()));
    vi.setSystemTime(1000);
    act(() => result.current.onPointerUp(pointer()));
    expect(result.current.percent).toBe(100);
  });

  it('pinches and hands the surviving finger a pan that is already moved', () => {
    const { result } = setup();

    act(() => result.current.onPointerDown(pointer({ pointerId: 1, clientX: 60, clientY: 100 })));
    act(() => result.current.onPointerDown(pointer({ pointerId: 2, clientX: 140, clientY: 100 })));
    expect(result.current.panning).toBe(true);

    act(() => result.current.onPointerMove(pointer({ pointerId: 2, clientX: 190, clientY: 100 })));
    expect(result.current.percent).toBeGreaterThan(100);

    act(() => result.current.onPointerUp(pointer({ pointerId: 2, clientX: 190, clientY: 100 })));
    expect(result.current.panning).toBe(true);

    act(() => result.current.onPointerMove(pointer({ pointerId: 1, clientX: 61, clientY: 100 })));
    act(() => result.current.onPointerUp(pointer({ pointerId: 1, clientX: 61, clientY: 100 })));
    expect(result.current.panning).toBe(false);
  });

  it('zooms with the wheel in every delta mode', () => {
    const { result, stage } = setup();
    expect(stage.wheel).toHaveLength(1);

    act(() =>
      stage.wheel[0]!({
        deltaY: -100,
        deltaMode: 0,
        clientX: 100,
        clientY: 100,
        target: null,
        preventDefault: vi.fn(),
      } as unknown as WheelEvent),
    );
    expect(result.current.percent).toBeGreaterThan(100);

    act(() =>
      stage.wheel[0]!({
        deltaY: 2,
        deltaMode: 1,
        clientX: 100,
        clientY: 100,
        target: null,
        preventDefault: vi.fn(),
      } as unknown as WheelEvent),
    );
    const line = result.current.percent;

    act(() =>
      stage.wheel[0]!({
        deltaY: 3,
        deltaMode: 2,
        clientX: 100,
        clientY: 100,
        target: null,
        preventDefault: vi.fn(),
      } as unknown as WheelEvent),
    );
    expect(result.current.percent).not.toBe(line);

    const before = result.current.percent;
    act(() =>
      stage.wheel[0]!({
        deltaY: -100,
        deltaMode: 0,
        clientX: 0,
        clientY: 0,
        target: clickTarget(),
        preventDefault: vi.fn(),
      } as unknown as WheelEvent),
    );
    expect(result.current.percent).toBe(before);
  });

  it('re-clamps a zoomed photo on load and on resize', () => {
    const { result } = setup();
    act(() => result.current.attachImage(makeImage()));

    act(() => result.current.onLoad());
    expect(result.current.percent).toBe(100);

    act(() => result.current.zoomIn());
    act(() => result.current.onLoad());
    expect(result.current.percent).toBe(150);

    act(() => {
      globalThis.dispatchEvent(new Event('resize'));
    });
    expect(result.current.percent).toBe(150);
  });

  it('leaves a 1x photo alone when the window resizes', () => {
    const { result, rerender } = setup();
    act(() => result.current.attachImage(makeImage()));

    act(() => {
      globalThis.dispatchEvent(new Event('resize'));
    });
    expect(result.current.percent).toBe(100);

    act(() => result.current.zoomIn());
    rerender(2);
    act(() => {
      globalThis.dispatchEvent(new Event('resize'));
    });
    expect(result.current.percent).toBe(100);
  });
});
