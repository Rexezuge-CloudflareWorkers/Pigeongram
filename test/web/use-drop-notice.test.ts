import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDropNotice } from '../../apps/web/src/components/useDropNotice';

/**
 * The shell's notice slot. The toast surface owns the countdown, so this only
 * keeps the current notice and clears it on request; every notify carries a
 * fresh token so a repeated message still counts as a new arrival.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDropNotice', () => {
  it('keeps the latest notice', () => {
    const { result } = renderHook(() => useDropNotice());

    void act(() => result.current.notify('First'));
    expect(result.current.notice?.text).toBe('First');

    void act(() => result.current.notify('Second'));
    expect(result.current.notice?.text).toBe('Second');
  });

  it('gives every notify a fresh token, even for the same text', () => {
    const { result } = renderHook(() => useDropNotice());

    void act(() => result.current.notify('Copied'));
    const first = result.current.notice;
    expect(first).not.toBeNull();

    void act(() => result.current.notify('Copied'));
    expect(result.current.notice?.token).not.toBe(first?.token);
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
    expect(result.current.notice?.text).toBe('Dropped');
  });
});
