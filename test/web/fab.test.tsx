import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JumpToLatestButton } from '../../apps/web/src/components/Fab';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('JumpToLatestButton', () => {
  it('spins the ring on click, then returns to the arrow', () => {
    vi.useFakeTimers();
    render(<JumpToLatestButton onClick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Jump To Latest And Mark As Read' });
    expect(button.querySelector('[data-icon="arrow-down"]')).not.toBeNull();

    fireEvent.click(button);

    expect(button.querySelector('.spinner-ring')).not.toBeNull();
    expect(button.querySelector('[data-icon="arrow-down"]')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Jump In Progress');

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(button.querySelector('[data-icon="arrow-down"]')).not.toBeNull();
    expect(button.querySelector('.spinner-ring')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('holds the ring for the whole jump, past the minimum spin', () => {
    vi.useFakeTimers();
    render(<JumpToLatestButton onClick={() => {}} busy />);
    fireEvent.click(screen.getByRole('button'));

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByRole('button').querySelector('.spinner-ring')).not.toBeNull();
  });

  it('refuses a second click while spinning', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<JumpToLatestButton onClick={onClick} />);
    const button = screen.getByRole('button');

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('clears its timer when unmounted mid-spin', () => {
    vi.useFakeTimers();
    const onClick = vi.fn(() => {});
    const { unmount } = render(<JumpToLatestButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(600);
      });
    }).not.toThrow();
  });
});
