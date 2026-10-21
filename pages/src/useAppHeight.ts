import { useEffect } from 'react';

/**
 * Sizes the signed-in shell to the visual viewport, which is the area left
 * above the on-screen keyboard. Neither `100%` nor `dvh` follows that keyboard:
 * mobile browsers keep the layout viewport at its pre-keyboard height and
 * overlay the keyboard on it, so a chat shell ending in a composer would put
 * that composer behind it. The visual height is mirrored into `--app-height`
 * (consumed by `.app`), so the composer stays reachable and the message list
 * shrinks instead.
 *
 * Pinch-zoom also shrinks the visual viewport, but it is not a layout change:
 * the property is dropped then, so a zoomed reader pans the full shell rather
 * than being handed a smaller copy of it.
 */
export function useAppHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;

    const update = (): void => {
      // A zoomed viewport is not the keyboard; keep the layout-sized shell.
      if (viewport.scale > 1.001) {
        root.style.removeProperty('--app-height');
        return;
      }
      if (viewport.height <= 0) return;
      root.style.setProperty('--app-height', `${Math.round(viewport.height)}px`);
    };

    // The visual viewport has no observer API: its `resize` event is the only
    // signal that the on-screen keyboard changed the visible area.
    // eslint-disable-next-line unicorn/prefer-observer-apis -- ResizeObserver sees elements, not the visual viewport the keyboard resizes.
    viewport.addEventListener('resize', update);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      root.style.removeProperty('--app-height');
    };
  }, []);
}
