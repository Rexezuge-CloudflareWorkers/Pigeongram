import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from '../../apps/web/src/components/Avatar';

/**
 * The profile picture and its fallbacks.
 *
 * The load is deliberately deferred until the avatar is near the viewport, so
 * the tests drive both the observer and the no-observer path.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface FakeObserver {
  callback: IntersectionObserverCallback;
  disconnected: boolean;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function installObserver(): FakeObserver[] {
  const observers: FakeObserver[] = [];
  class Observer {
    readonly callback: IntersectionObserverCallback;
    readonly observe = vi.fn();
    disconnected = false;
    readonly disconnect = vi.fn(() => {
      this.disconnected = true;
    });

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      observers.push(this as unknown as FakeObserver);
    }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  return observers;
}

describe('Avatar', () => {
  it('falls back to the initials of the title', () => {
    render(<Avatar chatId={2} photo={null} title="Bob Smith" />);
    expect(screen.getByText('BS')).toBeDefined();
  });

  it('asks for the photo at once when the browser has no observer', () => {
    render(<Avatar chatId={2} photo="v1" title="Bob" />);

    const image = document.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('/user/avatar?chatId=2&size=small&v=v1');
    expect(image.getAttribute('loading')).toBe('lazy');
  });

  it('waits for the avatar to near the viewport before loading it', () => {
    const observers = installObserver();
    render(<Avatar chatId={2} photo="v1" title="Bob" />);

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('B')).toBeDefined();
    expect(observers[0]?.observe).toHaveBeenCalledOnce();

    act(() => {
      observers[0]?.callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(document.querySelector('img')).toBeNull();

    act(() => {
      observers[0]?.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(document.querySelector('img')).not.toBeNull();
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });

  it('disconnects the observer when it unmounts before the avatar appears', () => {
    const observers = installObserver();
    const { unmount } = render(<Avatar chatId={2} photo="v1" title="Bob" />);

    unmount();

    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });

  it('remembers a failed version so a refreshed photo gets a fresh chance', () => {
    const { rerender } = render(<Avatar chatId={2} photo="v1" title="Bob" />);
    fireEvent.error(document.querySelector('img')!);

    expect(screen.getByText('B')).toBeDefined();

    rerender(<Avatar chatId={2} photo="v2" title="Bob" />);
    expect(document.querySelector('img')!.getAttribute('src')).toContain('v=v2');
  });

  it('marks an online peer and leaves everyone else unmarked', () => {
    const { rerender } = render(<Avatar chatId={2} photo={null} title="Bob" presence={{ status: 'online', lastSeenAt: null }} />);
    const badge = document.querySelector('[data-status="online"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('aria-hidden')).toBe('true');

    rerender(<Avatar chatId={2} photo={null} title="Bob" presence={{ status: 'offline', lastSeenAt: 1 }} />);
    expect(document.querySelector('[data-status="online"]')).toBeNull();
  });

  it('carries the size and kind classes the list and the profile ask for', () => {
    const { rerender } = render(<Avatar chatId={2} photo={null} title="Bob" small kind="group" />);
    expect(document.querySelector('.avatar.small.kind-group')).not.toBeNull();

    rerender(<Avatar chatId={2} photo={null} title="Bob" big />);
    expect(document.querySelector('.avatar.size-28')).not.toBeNull();
  });

  it('requests the large avatar from the profile', () => {
    render(<Avatar chatId={2} photo="v3" title="Bob" big />);
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/user/avatar?chatId=2&size=big&v=v3');
  });
});
