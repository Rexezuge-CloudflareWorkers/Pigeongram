/**
 * The pure geometry behind the media viewer's gallery swipe. The viewer's hook
 * owns the pointers and the state; this module answers "which way is this
 * gesture going, how far should the media follow it, and does releasing it
 * commit to a neighbour?".
 *
 * A swipe is horizontal when it dominates the vertical travel by `AXIS_RATIO`.
 * The media follows the finger with the same horizontal distance, except at
 * the ends of the album, where the missing neighbour is reported back to the
 * finger as `EDGE_RESISTANCE` rather than a dead stop.
 */

export const SWIPE_MIN_PX = 64;
export const EDGE_RESISTANCE = 0.25;

const SLOP_PX = 8;
const AXIS_RATIO = 1.5;

export type SwipeAxis = 'horizontal' | 'vertical';

/**
 * The gesture's axis once the pointer has moved past the slop, or null while
 * the movement is still too small to call.
 */
export function swipeAxis(dx: number, dy: number): SwipeAxis | null {
  if (Math.hypot(dx, dy) < SLOP_PX) return null;
  return Math.abs(dx) >= Math.abs(dy) * AXIS_RATIO ? 'horizontal' : 'vertical';
}

/**
 * The gallery's follow translation for a horizontal drag. Swiping towards a
 * neighbour the album does not have is damped, so the media still answers the
 * gesture without pretending there is somewhere to go.
 */
export function followOffset(dx: number, canPrev: boolean, canNext: boolean): number {
  if (dx < 0 && !canNext) return dx * EDGE_RESISTANCE;
  if (dx > 0 && !canPrev) return dx * EDGE_RESISTANCE;
  return dx;
}

/**
 * The committed step on release: 1 for the next item (finger left), -1 for the
 * previous one, or null when the gesture stayed short or vertical.
 */
export function swipeDirection(dx: number, dy: number): 1 | -1 | null {
  if (swipeAxis(dx, dy) !== 'horizontal' || Math.abs(dx) < SWIPE_MIN_PX) return null;
  return dx < 0 ? 1 : -1;
}
