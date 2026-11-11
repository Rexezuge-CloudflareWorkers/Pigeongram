import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDropNotice } from '../../apps/web/src/components/useDropNotice';

/**
 * The shell's notice slot. The toast surface owns the countdown, so this only
 * keeps the current notice and clears it on request.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDropNotice', () => {
  it('keeps the latest notice', () => {
    const { result } = renderHook(() => useDropNotice());

    void act(() => result.current.notify('First'));
    expect(result.current.notice).toBe('First');

    void act(() => result.current.notify('Second'));
    expect(result.current.notice).toBe('Second');
  });

  it('clears a notice on demand', () => {
    const { result } = renderHook(() => useDropNotice());

    void act(() => result.current.notify('Dropped'));
    void act(() => result.current.clearNotice());
    expect(result.current.notice).toBeNull();
  });

  it('does not run its own auto-dismiss timer', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDropNotice());

    void act(() => result.current.notify('Dropped'));
    void act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.notice).toBe('Dropped');
  });
});
