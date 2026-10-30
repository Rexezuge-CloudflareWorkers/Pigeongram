/**
 * The pointer helpers the viewer's gesture hooks share. Kept apart from
 * `photo-gestures.ts` so the zoom and swipe hooks can both use them without
 * either owning the other's bookkeeping.
 */

/**
 * Whether a press landed on a button or a link, which keeps its own click and
 * must not start a gesture.
 */
export function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a') !== null;
}

export function capturePointer(element: Element, pointerId: number): void {
  if (typeof element.setPointerCapture === 'function') element.setPointerCapture(pointerId);
}

export function releasePointer(element: Element, pointerId: number): void {
  if (typeof element.releasePointerCapture !== 'function') return;
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    // The pointer may already be gone; release is best-effort.
  }
}
