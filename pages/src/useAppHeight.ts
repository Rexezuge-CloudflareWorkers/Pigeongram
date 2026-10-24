import { useEffect } from 'react';

/**
 * Caps the signed-in shell at the area left above the on-screen keyboard.
 * `dvh` already carries the browser's own auto-hiding chrome (see `.app` in
 * `base.css`) and, under Chromium's `resizes-content`, the keyboard too. What
 * it cannot cover is a keyboard that only shrinks the visual viewport (iOS
 * Safari): `dvh` stays at its full height while the composer sits behind the
 * keyboard. Mobile browsers may also keep the layout viewport at its
 * pre-keyboard height and overlay the keyboard on it, and some report the
 * visual height late or a little differently. The smaller of the layout and
 * visual heights is the area both agree is visible, so the composer stays
 * reachable whichever viewport the browser updates last.
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

    // The visual viewport has no observer API: its `resize` event is the main
    // signal that the on-screen keyboard changed the visible area. A browser
    // can also report the change as a pan (a `scroll`, as when it moves the
    // viewport to reveal the focused composer), so both re-measure. The update
    // is idempotent, so the extra event costs one style write at most.
    // eslint-disable-next-line unicorn/prefer-observer-apis -- ResizeObserver sees elements, not the visual viewport the keyboard resizes.
    viewport.addEventListener('resize', update);
    // eslint-disable-next-line unicorn/prefer-observer-apis -- ResizeObserver does not observe a pan of the visual viewport.
    viewport.addEventListener('scroll', update);
    // Chromium can resize only the layout viewport under
    // `interactive-widget=resizes-content`; observing the root catches that.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(root);
    update();
    return () => {
      observer?.disconnect();
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--app-height');
    };
  }, []);
}
