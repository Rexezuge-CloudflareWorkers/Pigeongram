import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDropNotice } from '../../apps/web/src/components/useDropNotice';

/**
 * The notice toast's auto-dismiss timer. A notice clears itself, `notify`
 * refreshes the timer on every new toast, and `clearNotice` cancels it.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDropNotice', () => {
  it('shows a notice and clears it after four seconds', () => {
    const { result } = renderHook(() => useDropNotice());

    void act(() => result.current.notify('Upload failed'));
    expect(result.current.notice).toBe('Upload failed');

    void act(() => vi.advanceTimersByTime(3999));
    expect(result.current.notice).toBe('Upload failed');

    void act(() => vi.advanceTimersByTime(1));
    expect(result.current.notice).toBeNull();
  });

  it('restarts the timer when a new notice arrives', () => {
    const { result } = renderHook(() => useDropNotice());

    void act(() => result.current.notify('First'));
    void act(() => vi.advanceTimersByTime(3000));
    void act(() => result.current.notify('Second'));

    void act(() => vi.advanceTimersByTime(3000));
    expect(result.current.notice).toBe('Second');

    void act(() => vi.advanceTimersByTime(1000));
    expect(result.current.notice).toBeNull();
  });

  it('clears a notice on demand and cancels its timer', () => {
    const { result } = renderHook(() => useDropNotice());

    void act(() => result.current.notify('Dropped'));
    void act(() => result.current.clearNotice());
    expect(result.current.notice).toBeNull();

    void act(() => result.current.clearNotice());
    void act(() => vi.advanceTimersByTime(4000));
    expect(result.current.notice).toBeNull();
  });

  it('cancels the timer when it unmounts', () => {
    const { result, unmount } = renderHook(() => useDropNotice());
    void act(() => result.current.notify('Dropped'));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
