import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toasts } from '../../apps/web/src/components/Toasts';
import type { ToastMessage } from '../../apps/web/src/toast-message';

/**
 * The toast surface's two lifetimes and their shared countdown bar. A notice
 * lives four seconds and an error eight; hovering freezes both the clock and
 * the bar, and the error can also be dismissed by hand. A newer toast preempts
 * the one on screen instead of queueing behind it.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface ToastProps {
  error?: ToastMessage | null;
  notice?: ToastMessage | null;
}

const dismissError = vi.fn<() => void>();
const dismissNotice = vi.fn<() => void>();

function toast(text: string, token = 1): ToastMessage {
  return { text, token };
}

function toastsElement({ error = null, notice = null }: ToastProps): ReactElement {
  return <Toasts error={error} notice={notice} onDismissError={dismissError} onDismissNotice={dismissNotice} />;
}

function renderToasts(props: ToastProps = {}): ReturnType<typeof render> & {
  render: (next: ToastProps) => void;
} {
  const view = render(toastsElement(props));
  return { ...view, render: (next: ToastProps) => view.rerender(toastsElement(next)) };
}

beforeEach(() => {
  dismissError.mockClear();
  dismissNotice.mockClear();
});

describe('Toasts', () => {
  it('dismisses the notice at four seconds and the error at eight', () => {
    renderToasts({ error: toast('Upload failed'), notice: toast('Copied') });

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
    const { container } = renderToasts({ error: toast('Upload failed') });
    const bar = container.querySelector<HTMLElement>('.toast-progress-bar');

    expect(bar?.style.width).toBe('100%');
    void act(() => vi.advanceTimersByTime(4000));
    expect(bar?.style.width).toBe('50%');
  });

  it('pauses on hover and resumes from the same point', () => {
    renderToasts({ error: toast('Upload failed') });
    const alert = screen.getByRole('alert');

    void act(() => vi.advanceTimersByTime(3000));
    fireEvent.mouseEnter(alert);
    void act(() => vi.advanceTimersByTime(10_000));
    expect(dismissError).not.toHaveBeenCalled();

    fireEvent.mouseLeave(alert);
    void act(() => vi.advanceTimersByTime(4999));
    expect(dismissError).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(1));
    expect(dismissError).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh countdown for a new toast, even the same text again', () => {
    const { render: rerender, container } = renderToasts({ error: toast('Upload failed') });

    void act(() => vi.advanceTimersByTime(4000));
    expect(container.querySelector<HTMLElement>('.toast-progress-bar')?.style.width).toBe('50%');

    rerender({});
    void act(() => vi.advanceTimersByTime(200));
    rerender({ error: toast('Upload failed', 2) });

    expect(container.querySelector<HTMLElement>('.toast-progress-bar')?.style.width).toBe('100%');
    void act(() => vi.advanceTimersByTime(7999));
    expect(dismissError).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(1));
    expect(dismissError).toHaveBeenCalledTimes(1);
  });

  it('preempts the toast on screen with the new arrival', () => {
    const { render: rerender, container } = renderToasts({ notice: toast('Copied', 1) });

    void act(() => vi.advanceTimersByTime(1000));
    rerender({ notice: toast('Chat Pinned', 2) });

    // The new toast is on screen now, at full duration, while the old one
    // runs its exit beat beside it.
    const labels = screen.getAllByRole('status');
    expect(labels.map((item) => item.textContent)).toEqual(['Copied', 'Chat Pinned']);
    const bars = container.querySelectorAll<HTMLElement>('.toast-progress-bar');
    expect(bars[0]?.style.width).toBe('75%');
    expect(bars[1]?.style.width).toBe('100%');
    expect(dismissNotice).not.toHaveBeenCalled();

    void act(() => vi.advanceTimersByTime(220));
    expect(screen.getAllByRole('status').map((item) => item.textContent)).toEqual(['Chat Pinned']);

    void act(() => vi.advanceTimersByTime(3779));
    expect(dismissNotice).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(1));
    expect(dismissNotice).toHaveBeenCalledTimes(1);
  });

  it('treats an identical message with a new token as a fresh arrival', () => {
    const { render: rerender, container } = renderToasts({ notice: toast('Copied', 1) });

    void act(() => vi.advanceTimersByTime(3000));
    rerender({ notice: toast('Copied', 2) });

    // The old copy is fading out and the fresh one is already at full.
    const bars = container.querySelectorAll<HTMLElement>('.toast-progress-bar');
    expect(bars[0]?.style.width).toBe('25%');
    expect(bars[1]?.style.width).toBe('100%');
    void act(() => vi.advanceTimersByTime(220));
    expect(screen.getAllByRole('status')).toHaveLength(1);

    void act(() => vi.advanceTimersByTime(3779));
    expect(dismissNotice).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(1));
    expect(dismissNotice).toHaveBeenCalledTimes(1);
  });

  it('dismisses the error from its action', () => {
    renderToasts({ error: toast('Upload failed') });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(dismissError).toHaveBeenCalledTimes(1);
  });

  it('keeps the message on screen through the exit animation', () => {
    const { render: rerender } = renderToasts({ error: toast('Upload failed') });

    rerender({});
    expect(screen.getByRole('alert').textContent).toContain('Upload failed');

    void act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
