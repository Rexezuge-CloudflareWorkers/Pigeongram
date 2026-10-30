import {
  APPROXIMATE,
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  clampView,
  distance,
  midpoint,
  stageCenter,
  type Point,
  type StoredView,
  type View,
} from './photo-zoom';

/**
 * The pointer bookkeeping the zoom hook shares between its handlers. These are
 * plain functions over refs so the hook stays about React and the geometry
 * module stays about view math.
 */

export const DOUBLE_TAP_MS = 320;
const TAP_SLOP_PX = 24;

export interface PanGesture {
  kind: 'pan';
  startView: View;
  start: Point;
  startedAt: number;
  moved: boolean;
}

export interface PinchGesture {
  kind: 'pinch';
  startView: View;
  startDistance: number;
  startMid: Point;
}

export type Gesture = PanGesture | PinchGesture;

export interface TapTracker {
  lastTouchAt: number;
  last: { at: number; point: Point } | null;
}

export function createTapTracker(): TapTracker {
  return { lastTouchAt: 0, last: null };
}

/**
 * Records a completed tap and fires the toggle when it pairs with the previous
 * one. The tracker lives in a ref, so the timing survives re-renders without
 * pulling React into the gesture math.
 */
export function registerTap(tracker: TapTracker, point: Point, toggle: (clientX: number, clientY: number) => void): void {
  const now = Date.now();
  const previous = tracker.last;
  if (previous !== null && now - previous.at <= DOUBLE_TAP_MS && distance(previous.point, point) <= TAP_SLOP_PX) {
    tracker.last = null;
    tracker.lastTouchAt = now;
    toggle(point.x, point.y);
    return;
  }
  tracker.last = { at: now, point };
}

/**
 * Applies a two-pointer update: scale from the distance change, translate by
 * the midpoint change, and keep the content point under the starting midpoint
 * beneath the current one.
 */
export function movePinch(
  active: PinchGesture,
  pointers: Map<number, Point>,
  commit: (view: StoredView) => void,
  mediaId: number | null,
  stage: HTMLElement | null,
  image: HTMLImageElement | null,
): void {
  if (pointers.size < 2) return;
  const [first, second] = [...pointers.values()];
  if (!first || !second) return;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, active.startView.scale * (distance(first, second) / active.startDistance)));
  if (scale <= MIN_SCALE + APPROXIMATE) {
    commit({ mediaId, ...IDENTITY });
    return;
  }
  const center = stageCenter(stage);
  const from = { x: active.startMid.x - center.x, y: active.startMid.y - center.y };
  const to = midpoint(first, second);
  const ratio = scale / active.startView.scale;
  commit({
    mediaId,
    ...clampView(
      {
        scale,
        x: to.x - center.x - (from.x - active.startView.x) * ratio,
        y: to.y - center.y - (from.y - active.startView.y) * ratio,
      },
      image,
    ),
  });
}
