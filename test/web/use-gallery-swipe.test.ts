import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDGE_RESISTANCE, SWIPE_MIN_PX } from '../../apps/web/src/gallery-swipe';
import { useGallerySwipe } from '../../apps/web/src/useGallerySwipe';
import type { GallerySwipe } from '../../apps/web/src/useGallerySwipe';

/**
 * The viewer's swipe hook. The geometry is tested in `gallery-swipe.test.ts`;
 * here the pointer bookkeeping and the React state are driven directly, since
 * jsdom has no gesture recogniser.
 */

interface HookProps {
  enabled: boolean;
  mediaId: number;
  canPrev: boolean;
  canNext: boolean;
}

function pointer(
  overrides: {
    pointerId?: number;
    pointerType?: string;
    clientX?: number;
    clientY?: number;
    target?: EventTarget | null;
  } = {},
): never {
  return {
    pointerId: overrides.pointerId ?? 1,
    pointerType: overrides.pointerType ?? 'touch',
    button: 0,
    clientX: overrides.clientX ?? 200,
    clientY: overrides.clientY ?? 200,
    target: overrides.target ?? null,
    currentTarget: { setPointerCapture: () => {}, releasePointerCapture: () => {} },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as never;
}

function controlTarget(): EventTarget {
  return document.createElement('button');
}

function setup(options: Partial<HookProps> = {}): {
  result: { current: GallerySwipe };
  rerender: (props: Partial<HookProps>) => void;
  onSwipe: ReturnType<typeof vi.fn>;
} {
  const onSwipe = vi.fn();
  let props: HookProps = {
    enabled: options.enabled ?? true,
    mediaId: options.mediaId ?? 1,
    canPrev: options.canPrev ?? true,
    canNext: options.canNext ?? true,
  };
  const rendered = renderHook((current: HookProps) => useGallerySwipe({ ...current, onSwipe }), { initialProps: props });
  return {
    result: rendered.result as { current: GallerySwipe },
    rerender: (next) => {
      props = { ...props, ...next };
      rendered.rerender(props);
    },
    onSwipe,
  };
}

afterEach(cleanup);

describe('useGallerySwipe', () => {
  it('follows a horizontal drag and settles back below the threshold', () => {
    const { result, onSwipe } = setup();

    act(() => result.current.onPointerDown(pointer({ clientX: 200, clientY: 200 })));
    act(() => result.current.onPointerMove(pointer({ clientX: 140, clientY: 204 })));
    expect(result.current.style?.transform).toBe('translate3d(-60px, 0, 0)');
    expect(result.current.settling).toBe(false);

    act(() => result.current.onPointerUp(pointer({ clientX: 140, clientY: 204 })));
    expect(result.current.style?.transform).toBe('translate3d(0px, 0, 0)');
    expect(result.current.settling).toBe(true);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('commits left to the next item and right to the previous one', () => {
    const next = setup();
    act(() => next.result.current.onPointerDown(pointer()));
    act(() => next.result.current.onPointerMove(pointer({ clientX: 200 - SWIPE_MIN_PX - 1 })));
    act(() => next.result.current.onPointerUp(pointer({ clientX: 200 - SWIPE_MIN_PX - 1 })));
    expect(next.onSwipe).toHaveBeenCalledWith(1);

    const previous = setup();
    act(() => previous.result.current.onPointerDown(pointer()));
    act(() => previous.result.current.onPointerMove(pointer({ clientX: 200 + SWIPE_MIN_PX + 1 })));
    act(() => previous.result.current.onPointerUp(pointer({ clientX: 200 + SWIPE_MIN_PX + 1 })));
    expect(previous.onSwipe).toHaveBeenCalledWith(-1);
  });

  it('mounts the neighbour at rest when the media id changes', () => {
    const { result, rerender, onSwipe } = setup();

    act(() => result.current.onPointerDown(pointer({ clientX: 300 })));
    act(() => result.current.onPointerMove(pointer({ clientX: 200 })));
    act(() => result.current.onPointerUp(pointer({ clientX: 200 })));
    expect(onSwipe).toHaveBeenCalledWith(1);

    rerender({ mediaId: 2 });
    expect(result.current.style?.transform).toBe('translate3d(0px, 0, 0)');
    expect(result.current.settling).toBe(false);
  });

  it('resists at an edge and does not commit', () => {
    const { result, onSwipe } = setup({ canNext: false });

    act(() => result.current.onPointerDown(pointer({ clientX: 200 })));
    act(() => result.current.onPointerMove(pointer({ clientX: 100 })));
    expect(result.current.style?.transform).toBe(`translate3d(${-100 * EDGE_RESISTANCE}px, 0, 0)`);

    act(() => result.current.onPointerUp(pointer({ clientX: 100 })));
    expect(onSwipe).not.toHaveBeenCalled();
    expect(result.current.settling).toBe(true);
  });

  it('leaves a vertical drag alone but still marks it as a drag', () => {
    const { result, onSwipe } = setup();

    act(() => result.current.onPointerDown(pointer({ clientX: 200, clientY: 200 })));
    act(() => result.current.onPointerMove(pointer({ clientX: 205, clientY: 280 })));
    expect(result.current.style?.transform).toBe('translate3d(0px, 0, 0)');
    expect(result.current.consumeDrag()).toBe(true);

    act(() => result.current.onPointerUp(pointer({ clientX: 205, clientY: 280 })));
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('cancels the swipe when a second pointer starts a pinch', () => {
    const { result, onSwipe } = setup();

    act(() => result.current.onPointerDown(pointer({ pointerId: 1, clientX: 200 })));
    act(() => result.current.onPointerMove(pointer({ pointerId: 1, clientX: 140 })));
    act(() => result.current.onPointerDown(pointer({ pointerId: 2, clientX: 260 })));
    expect(result.current.settling).toBe(true);

    act(() => result.current.onPointerMove(pointer({ pointerId: 1, clientX: 100 })));
    act(() => result.current.onPointerUp(pointer({ pointerId: 1, clientX: 100 })));
    expect(result.current.style?.transform).toBe('translate3d(0px, 0, 0)');
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('does not commit a cancelled gesture', () => {
    const { result, onSwipe } = setup();

    act(() => result.current.onPointerDown(pointer({ clientX: 300 })));
    act(() => result.current.onPointerMove(pointer({ clientX: 100 })));
    act(() => result.current.onPointerCancel(pointer({ clientX: 100 })));
    expect(onSwipe).not.toHaveBeenCalled();
    expect(result.current.settling).toBe(true);
  });

  it('ignores a mouse drag, a control and a disabled hook', () => {
    const { result: mouse, onSwipe: mouseSwipe } = setup();
    act(() => mouse.current.onPointerDown(pointer({ pointerType: 'mouse', clientX: 300 })));
    act(() => mouse.current.onPointerMove(pointer({ pointerType: 'mouse', clientX: 100 })));
    act(() => mouse.current.onPointerUp(pointer({ pointerType: 'mouse', clientX: 100 })));
    expect(mouseSwipe).not.toHaveBeenCalled();
    expect(mouse.current.consumeDrag()).toBe(false);

    const { result: control, onSwipe: controlSwipe } = setup();
    act(() => control.current.onPointerDown(pointer({ target: controlTarget(), clientX: 300 })));
    act(() => control.current.onPointerMove(pointer({ clientX: 100 })));
    act(() => control.current.onPointerUp(pointer({ clientX: 100 })));
    expect(controlSwipe).not.toHaveBeenCalled();

    const { result: disabled, onSwipe: disabledSwipe } = setup({ enabled: false });
    act(() => disabled.current.onPointerDown(pointer({ clientX: 300 })));
    act(() => disabled.current.onPointerMove(pointer({ clientX: 100 })));
    act(() => disabled.current.onPointerUp(pointer({ clientX: 100 })));
    expect(disabledSwipe).not.toHaveBeenCalled();
    expect(disabled.current.style).toBeUndefined();
  });
});
