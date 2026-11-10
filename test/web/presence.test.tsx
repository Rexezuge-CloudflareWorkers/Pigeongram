import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Presence } from '../../apps/web/src/components/Presence';

/**
 * The wrapper that keeps an overlay mounted for its exit keyframe after its
 * visibility has already flipped off.
 */

interface OverlayProps {
  exiting?: boolean;
}

function Overlay({ exiting = false }: OverlayProps) {
  return <div data-testid="overlay" data-exiting={exiting ? 'true' : 'false'} />;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Presence', () => {
  it('renders nothing while the overlay starts closed', () => {
    render(
      <Presence visible={false}>
        <Overlay />
      </Presence>,
    );

    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('reports the exit beat, then unmounts', () => {
    const { rerender } = render(
      <Presence visible>
        <Overlay />
      </Presence>,
    );
    expect(screen.getByTestId('overlay').dataset.exiting).toBe('false');

    rerender(
      <Presence visible={false}>
        <Overlay />
      </Presence>,
    );
    expect(screen.getByTestId('overlay').dataset.exiting).toBe('true');

    void act(() => vi.advanceTimersByTime(149));
    expect(screen.getByTestId('overlay')).not.toBeNull();

    void act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('keeps the last visible child mounted after its state is cleared', () => {
    const { rerender } = render(
      <Presence visible>
        <Overlay />
      </Presence>,
    );

    rerender(<Presence visible={false}>{null}</Presence>);
    expect(screen.getByTestId('overlay').dataset.exiting).toBe('true');

    void act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByTestId('overlay')).toBeNull();
  });
});
