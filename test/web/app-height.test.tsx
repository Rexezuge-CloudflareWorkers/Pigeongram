import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHeight } from '../../pages/src/useAppHeight';

/**
 A visual viewport jsdom does not provide. The hook only reads `height` and
 `scale`, so the fake is an event target with those two fields.
 */
class FakeVisualViewport extends EventTarget {
  height = 800;
  scale = 1;
}

/**
 A root observer fake. jsdom has no ResizeObserver, and the hook watches the
 document element for Chromium's `resizes-content` layout changes.
 */
class FakeResizeObserver {
  static current: FakeResizeObserver | null = null;

  readonly targets = new Set<Element>();

  private disconnected = false;

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.current = this;
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  disconnect(): void {
    this.disconnected = true;
    this.targets.clear();
    if (FakeResizeObserver.current === this) FakeResizeObserver.current = null;
  }

  fire(): void {
    if (this.disconnected) return;
    this.callback([], this as unknown as ResizeObserver);
  }
}

function Probe() {
  useAppHeight();
  return null;
}

function install(viewport: FakeVisualViewport): void {
  Object.defineProperty(globalThis, 'visualViewport', { configurable: true, value: viewport });
}

function setLayoutHeight(height: number): void {
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
}

function appHeight(): string {
  return document.documentElement.style.getPropertyValue('--app-height');
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  setLayoutHeight(800);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
  document.documentElement.style.removeProperty('--app-height');
  Reflect.deleteProperty(globalThis, 'visualViewport');
  FakeResizeObserver.current = null;
});

describe('useAppHeight', () => {
  it('takes the smaller of the layout and visual viewport heights', () => {
    const viewport = new FakeVisualViewport();
    install(viewport);
    render(<Probe />);
    expect(appHeight()).toBe('800px');

    // An overlay keyboard shrinks only the visual viewport.
    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('500px');

    // Chromium's `resizes-content` shrinks the layout viewport, but the visual
    // height can still report the taller pre-keyboard area.
    setLayoutHeight(480);
    viewport.height = 520;
    FakeResizeObserver.current?.fire();
    expect(appHeight()).toBe('480px');
  });

  it('observes the document element for layout-only resizes', () => {
    const viewport = new FakeVisualViewport();
    install(viewport);
    render(<Probe />);

    expect(FakeResizeObserver.current?.targets.has(document.documentElement)).toBe(true);

    setLayoutHeight(620);
    FakeResizeObserver.current?.fire();
    expect(appHeight()).toBe('620px');
  });

  it('floors a fractional visual height so the cap never sits above it', () => {
    const viewport = new FakeVisualViewport();
    install(viewport);
    render(<Probe />);

    // A keyboard can report a fractional height; the cap takes whole pixels,
    // and the only safe direction is down.
    viewport.height = 421.6;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('421px');
  });

  it('never publishes a cap above the measured height', () => {
    const viewport = new FakeVisualViewport();
    install(viewport);
    // A maximized desktop window at a fractional scale: `clientHeight` rounds
    // the viewport up to 901 while the visual viewport still knows the real
    // 900.6px. The cap is floored from the real height, so it never publishes
    // the 901 that used to leave the page a fraction of a pixel taller than the
    // screen and scroll a scrollbar onto it.
    setLayoutHeight(901);
    viewport.height = 900.6;
    render(<Probe />);

    expect(appHeight()).toBe('900px');
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

    const observer = FakeResizeObserver.current;
    unmount();
    expect(appHeight()).toBe('');
    expect(observer?.targets.size).toBe(0);
    observer?.fire();
    expect(appHeight()).toBe('');

    viewport.height = 300;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('');
  });
});
