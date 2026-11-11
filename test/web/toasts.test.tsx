import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toasts } from '../../apps/web/src/components/Toasts';

/**
 * The toast surface's two lifetimes and their shared countdown bar. A notice
 * lives four seconds and an error eight; hovering freezes both the clock and
 * the bar, and the error can also be dismissed by hand.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderToasts(
  error: string | null = null,
  notice: string | null = null,
): ReturnType<typeof render> & {
  dismissError: Mock<() => void>;
  dismissNotice: Mock<() => void>;
} {
  const dismissError = vi.fn<() => void>();
  const dismissNotice = vi.fn<() => void>();
  const view = render(<Toasts error={error} notice={notice} onDismissError={dismissError} onDismissNotice={dismissNotice} />);
  return { ...view, dismissError, dismissNotice };
}

describe('Toasts', () => {
  it('dismisses the notice at four seconds and the error at eight', () => {
    const { dismissError, dismissNotice } = renderToasts('Upload failed', 'Copied');

    expect(screen.getByRole('alert').textContent).toContain('Upload failed');
    expect(screen.getByRole('status').textContent).toContain('Copied');

    void act(() => vi.advanceTimersByTime(3999));
    expect(dismissNotice).not.toHaveBeenCalled();
    expect(dismissError).not.toHaveBeenCalled();

    void act(() => vi.advanceTimersByTime(1));
    expect(dismissNotice).toHaveBeenCalledTimes(1);
    expect(dismissError).not.toHaveBeenCalled();

    void act(() => vi.advanceTimersByTime(4000));
    expect(dismissError).toHaveBeenCalledTimes(1);
  });

  it('shows the remaining countdown in a bar', () => {
    const { container } = renderToasts('Upload failed');
    const bar = container.querySelector<HTMLElement>('.toast-progress-bar');

    expect(bar?.style.width).toBe('100%');
    void act(() => vi.advanceTimersByTime(4000));
    expect(bar?.style.width).toBe('50%');
  });

  it('pauses on hover and resumes from the same point', () => {
    const { dismissError } = renderToasts('Upload failed');
    const toast = screen.getByRole('alert');

    void act(() => vi.advanceTimersByTime(3000));
    fireEvent.mouseEnter(toast);
    void act(() => vi.advanceTimersByTime(10_000));
    expect(dismissError).not.toHaveBeenCalled();

    fireEvent.mouseLeave(toast);
    void act(() => vi.advanceTimersByTime(4999));
    expect(dismissError).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(1));
    expect(dismissError).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh countdown for a new toast, even the same text again', () => {
    const { rerender, dismissError, dismissNotice, container } = renderToasts('Upload failed');

    void act(() => vi.advanceTimersByTime(4000));
    expect(container.querySelector<HTMLElement>('.toast-progress-bar')?.style.width).toBe('50%');

    rerender(<Toasts error={null} notice={null} onDismissError={dismissError} onDismissNotice={dismissNotice} />);
    void act(() => vi.advanceTimersByTime(200));
    rerender(<Toasts error="Upload failed" notice={null} onDismissError={dismissError} onDismissNotice={dismissNotice} />);

    expect(container.querySelector<HTMLElement>('.toast-progress-bar')?.style.width).toBe('100%');
    void act(() => vi.advanceTimersByTime(7999));
    expect(dismissError).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(1));
    expect(dismissError).toHaveBeenCalledTimes(1);
  });

  it('dismisses the error from its action', () => {
    const { dismissError } = renderToasts('Upload failed');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(dismissError).toHaveBeenCalledTimes(1);
  });

  it('keeps the message on screen through the exit animation', () => {
    const { rerender, dismissError, dismissNotice } = renderToasts('Upload failed');

    rerender(<Toasts error={null} notice={null} onDismissError={dismissError} onDismissNotice={dismissNotice} />);
    expect(screen.getByRole('alert').textContent).toContain('Upload failed');

    void act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
