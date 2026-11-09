import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExitAnimation } from '../../apps/web/src/components/useExitAnimation';

/**
 * The exit beat an overlay spends after its visibility flips off, so a
 * dialog, toast or viewer can fade out instead of vanishing.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useExitAnimation', () => {
  it('is mounted and not exiting while visible', () => {
    const { result } = renderHook(() => useExitAnimation(true));

    expect(result.current).toEqual({ mounted: true, exiting: false });
  });

  it('keeps the overlay mounted for its exit animation', () => {
    const { result, rerender } = renderHook(({ visible }) => useExitAnimation(visible, 150), {
      initialProps: { visible: true },
    });

    rerender({ visible: false });
    expect(result.current).toEqual({ mounted: true, exiting: true });

    void act(() => vi.advanceTimersByTime(149));
    expect(result.current).toEqual({ mounted: true, exiting: true });

    void act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ mounted: false, exiting: false });
  });

  it('does not mount an overlay that starts hidden', () => {
    const { result } = renderHook(() => useExitAnimation(false));

    expect(result.current).toEqual({ mounted: false, exiting: false });
  });

  it('cancels a pending close when it becomes visible again', () => {
    const { result, rerender } = renderHook(({ visible }) => useExitAnimation(visible), {
      initialProps: { visible: true },
    });

    rerender({ visible: false });
    rerender({ visible: true });

    void act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ mounted: true, exiting: false });
  });
});
