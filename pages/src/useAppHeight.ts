import { useEffect } from 'react';

/**
 * Sizes the signed-in shell to the area left above the on-screen keyboard.
 * Neither `100%` nor `dvh` follows that keyboard: mobile browsers may keep the
 * layout viewport at its pre-keyboard height and overlay the keyboard on it, so
 * a chat shell ending in a composer would put that composer behind it. Chromium
 * can instead shrink the layout viewport (`interactive-widget=resizes-content`),
 * and some of those browsers report the visual height late or a little
 * differently. The smaller of the two is the area both agree is visible, so the
 * composer stays reachable whichever viewport the browser updates last.
 *
 * The published value *caps* the shell (`.app`'s `max-height`) rather than
 * sizing it, so it can only ever shorten it; it is floored to whole pixels so
 * the cap is never aimed above the area the two viewports agree on.
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
      // Chromium's `resizes-content` already shrank the layout viewport; other
      // browsers only shrink the visual one. Taking the smaller height keeps
      // the shell above a keyboard that either viewport fails to account for.
      const layoutHeight = root.clientHeight;
      const height = layoutHeight > 0 ? Math.min(layoutHeight, viewport.height) : viewport.height;
      // Floored, not rounded: the cap is a whole number of pixels, and the only
      // safe direction to be off in is down.
      root.style.setProperty('--app-height', `${Math.floor(height)}px`);
    };

    // The visual viewport has no observer API: its `resize` event is the only
    // signal that the on-screen keyboard changed the visible area.
    // eslint-disable-next-line unicorn/prefer-observer-apis -- ResizeObserver sees elements, not the visual viewport the keyboard resizes.
    viewport.addEventListener('resize', update);
    // Chromium can resize only the layout viewport under
    // `interactive-widget=resizes-content`; observing the root catches that.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(root);
    update();
    return () => {
      observer?.disconnect();
      viewport.removeEventListener('resize', update);
      root.style.removeProperty('--app-height');
    };
  }, []);
}
