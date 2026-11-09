import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageGestures } from '../../apps/web/src/components/useMessageGestures';

/**
 * The swipe-to-reply and reaction-burst state for a message row: the drag
 * translates the bubble until it crosses the reply threshold, then the reply
 * fires and the offset resets; the burst marker fades after one timeout.
 */

const vibrate = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('useMessageGestures', () => {
  it('follows a short swipe without firing the reply', () => {
    const { result } = renderHook(() => useMessageGestures());
    const onReply = vi.fn();

    void act(() => result.current.dragReply(40, onReply));

    expect(result.current.swipeOffset).toBe(14);
    expect(onReply).not.toHaveBeenCalled();
  });

  it('fires the reply and resets once the threshold is crossed', () => {
    const { result } = renderHook(() => useMessageGestures());
    const onReply = vi.fn();

    void act(() => result.current.dragReply(200, onReply));

    expect(onReply).toHaveBeenCalledOnce();
    expect(result.current.swipeOffset).toBe(0);
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('ignores a drag in the other direction', () => {
    const { result } = renderHook(() => useMessageGestures());
    const onReply = vi.fn();

    void act(() => result.current.dragReply(-80, onReply));

    expect(result.current.swipeOffset).toBe(0);
    expect(onReply).not.toHaveBeenCalled();
  });

  it('resets the offset on demand', () => {
    const { result } = renderHook(() => useMessageGestures());

    void act(() => result.current.dragReply(20, vi.fn()));
    expect(result.current.swipeOffset).toBeGreaterThan(0);

    void act(() => result.current.resetSwipe());
    expect(result.current.swipeOffset).toBe(0);
  });

  it('shows a burst marker and fades it after the frame timeout', () => {
    const { result } = renderHook(() => useMessageGestures());

    void act(() => result.current.burst('❤️'));
    expect(result.current.burstKey).toBe('❤️');
    expect(vibrate).toHaveBeenCalledWith(10);

    void act(() => vi.advanceTimersByTime(339));
    expect(result.current.burstKey).toBe('❤️');

    void act(() => vi.advanceTimersByTime(1));
    expect(result.current.burstKey).toBeNull();
  });
});
