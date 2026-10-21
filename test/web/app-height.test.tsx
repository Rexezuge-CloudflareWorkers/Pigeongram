import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAppHeight } from '../../pages/src/useAppHeight';

/**
 A visual viewport jsdom does not provide. The hook only reads `height` and
 `scale`, so the fake is an event target with those two fields.
 */
class FakeVisualViewport extends EventTarget {
  height = 800;
  scale = 1;
}

function Probe() {
  useAppHeight();
  return null;
}

function install(viewport: FakeVisualViewport): void {
  Object.defineProperty(globalThis, 'visualViewport', { configurable: true, value: viewport });
}

function appHeight(): string {
  return document.documentElement.style.getPropertyValue('--app-height');
}

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--app-height');
  Reflect.deleteProperty(globalThis, 'visualViewport');
});

describe('useAppHeight', () => {
  it('mirrors the visual viewport height into --app-height', () => {
    const viewport = new FakeVisualViewport();
    install(viewport);
    render(<Probe />);
    expect(appHeight()).toBe('800px');

    viewport.height = 420;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('420px');

    // A keyboard can report a fractional height; the shell takes whole pixels.
    viewport.height = 421.6;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('422px');
  });

  it('drops the override while pinch-zoomed and restores it at scale 1', () => {
    const viewport = new FakeVisualViewport();
    install(viewport);
    render(<Probe />);

    viewport.scale = 2;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('');

    viewport.scale = 1;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('800px');
  });

  it('takes the latest height and cleans up on unmount', () => {
    const viewport = new FakeVisualViewport();
    install(viewport);
    const { unmount } = render(<Probe />);

    viewport.height = 600;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('600px');

    unmount();
    expect(appHeight()).toBe('');
    viewport.height = 300;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('');
  });
});
