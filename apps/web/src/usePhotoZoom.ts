import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { createTapTracker, movePinch, registerTap, DOUBLE_TAP_MS, type Gesture } from './photo-gestures';
import { capturePointer, isControl, releasePointer } from './pointer';
import {
  anchorPoint,
  APPROXIMATE,
  clampView,
  distance,
  DOUBLE_TAP_SCALE,
  IDENTITY,
  MAX_SCALE,
  midpoint,
  MIN_SCALE,
  nextZoomStep,
  zoomAround,
  type Point,
  type StoredView,
  type View,
} from './photo-zoom';

/**
 * Zoom and pan for one photo in the full-page viewer.
 *
 * The hook owns a single view (`scale`, `x`, `y`). Photos are the only media
 * that opt in: the wheel, pinch and drag handlers are attached by the viewer
 * to the `<img>`, and `touch-action: none` on that element keeps the browser's
 * own page zoom out of the gesture. The math and the pointer bookkeeping live
 * in `photo-zoom.ts` and `photo-gestures.ts`.
 *
 * A media id is stored with the view rather than reset by an effect: when the
 * album moves to another message the old view is simply no longer current, and
 * the next gesture starts again from 1x. That keeps a navigation render pure
 * and avoids a reset-then-paint flash.
 */

const WHEEL_RATE = 0.0018;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 100;
const DRAG_SLOP_PX = 3;
const TAP_MS = 300;

interface UsePhotoZoomOptions {
  /**
  Photos only: videos keep their native player gestures.
  */
  enabled: boolean;
  /**
  The current message id; changing it discards the previous view.
  */
  mediaId: number | null;
  /**
  The stage whose center is the zoom anchor for buttons and double-click.
  */
  stageRef: RefObject<HTMLElement | null>;
}

export interface PhotoZoom {
  /**
   * A callback ref, rather than the ref object itself: the React compiler's
   * lint treats member access on an object that carries a `RefObject` as a
   * render-time ref read.
   */
  attachImage: (node: HTMLImageElement | null) => void;
  style: CSSProperties;
  zoomed: boolean;
  panning: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  percent: number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /**
   * Whether the last pointer sequence moved the photo. The viewer's backdrop
   * click uses this so releasing a pan never closes the dialog.
   */
  consumeDrag: () => boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void;
  onLoad: () => void;
}

export function usePhotoZoom({ enabled, mediaId, stageRef }: UsePhotoZoomOptions): PhotoZoom {
  const imageRef = useRef<HTMLImageElement>(null);
  const attachImage = useCallback((node: HTMLImageElement | null): void => {
    imageRef.current = node;
  }, []);
  const [stored, setStored] = useState<StoredView>({ mediaId, ...IDENTITY });
  const [pan, setPan] = useState<{ mediaId: number | null; active: boolean }>({ mediaId, active: false });
  const viewRef = useRef<StoredView>({ mediaId, ...IDENTITY });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const pointerMediaId = useRef<number | null>(mediaId);
  const dragged = useRef(false);
  const taps = useRef(createTapTracker());

  const view: View = enabled && stored.mediaId === mediaId ? stored : IDENTITY;
  // The id on the pan flag makes a stale gesture from the previous album item
  // invisible without a reset effect: the new item just starts unpanned.
  const panning = pan.mediaId === mediaId && pan.active;

  const commit = useCallback((next: StoredView): void => {
    viewRef.current = next;
    setStored(next);
  }, []);

  const currentView = useCallback((): StoredView => {
    const latest = viewRef.current;
    return enabled && latest.mediaId === mediaId ? latest : { mediaId, ...IDENTITY };
  }, [enabled, mediaId]);

  const markPanning = useCallback(
    (active: boolean): void => {
      setPan({ mediaId, active });
    },
    [mediaId],
  );

  const reset = useCallback((): void => {
    if (!enabled) return;
    commit({ mediaId, ...IDENTITY });
  }, [commit, enabled, mediaId]);

  const step = useCallback(
    (direction: 1 | -1): void => {
      if (!enabled) return;
      const base = currentView();
      const next = nextZoomStep(base.scale, direction);
      commit({ mediaId, ...zoomAround(base, next, { x: 0, y: 0 }, imageRef.current) });
    },
    [commit, currentView, enabled, mediaId],
  );

  const zoomIn = useCallback((): void => step(1), [step]);
  const zoomOut = useCallback((): void => step(-1), [step]);

  const toggleAt = useCallback(
    (clientX: number, clientY: number): void => {
      const base = currentView();
      if (base.scale > MIN_SCALE + APPROXIMATE) {
        commit({ mediaId, ...IDENTITY });
        return;
      }
      const anchor = anchorPoint(clientX, clientY, stageRef.current);
      commit({ mediaId, ...zoomAround(base, DOUBLE_TAP_SCALE, anchor, imageRef.current) });
    },
    [commit, currentView, mediaId, stageRef],
  );

  const consumeDrag = useCallback((): boolean => {
    const moved = dragged.current;
    dragged.current = false;
    return moved;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (!enabled || isControl(event.target)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (pointerMediaId.current !== mediaId) {
        pointers.current.clear();
        gesture.current = null;
        taps.current.last = null;
        pointerMediaId.current = mediaId;
      }
      const point: Point = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, point);
      dragged.current = false;

      if (pointers.current.size === 1) {
        const base = currentView();
        gesture.current = { kind: 'pan', startView: base, start: point, startedAt: Date.now(), moved: false };
        markPanning(base.scale > MIN_SCALE + APPROXIMATE);
        return;
      }

      if (pointers.current.size !== 2) return;
      const [first, second] = [...pointers.current.values()];
      if (!first || !second) return;
      gesture.current = {
        kind: 'pinch',
        startView: currentView(),
        startDistance: Math.max(distance(first, second), 1),
        startMid: midpoint(first, second),
      };
      for (const pointerId of pointers.current.keys()) capturePointer(event.currentTarget, pointerId);
      dragged.current = true;
      markPanning(true);
    },
    [currentView, enabled, markPanning, mediaId],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (!pointers.current.has(event.pointerId)) return;
      const point: Point = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, point);
      const active = gesture.current;
      if (active === null) return;

      if (active.kind === 'pinch') {
        movePinch(active, pointers.current, commit, mediaId, stageRef.current, imageRef.current);
        return;
      }

      const dx = point.x - active.start.x;
      const dy = point.y - active.start.y;
      if (Math.hypot(dx, dy) > DRAG_SLOP_PX) {
        if (!active.moved) capturePointer(event.currentTarget, event.pointerId);
        active.moved = true;
        dragged.current = true;
      }
      if (active.startView.scale <= MIN_SCALE + APPROXIMATE) return;
      commit({
        mediaId,
        ...clampView({ scale: active.startView.scale, x: active.startView.x + dx, y: active.startView.y + dy }, imageRef.current),
      });
    },
    [commit, mediaId, stageRef],
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean): void => {
      if (!pointers.current.has(event.pointerId)) return;
      const point = pointers.current.get(event.pointerId) ?? { x: event.clientX, y: event.clientY };
      pointers.current.delete(event.pointerId);
      releasePointer(event.currentTarget, event.pointerId);
      const active = gesture.current;

      if (pointers.current.size === 0) {
        gesture.current = null;
        markPanning(false);
        if (active?.kind === 'pan' && active.moved) taps.current.last = null;
        if (cancelled) {
          taps.current.last = null;
          return;
        }
        if (active?.kind !== 'pan' || active.moved || event.pointerType !== 'touch' || Date.now() - active.startedAt > TAP_MS) return;
        registerTap(taps.current, point, toggleAt);
        return;
      }

      if (pointers.current.size !== 1) return;
      const [remaining] = [...pointers.current.values()];
      if (!remaining) return;
      const base = currentView();
      // A pinch that loses one finger must not turn the survivor's release
      // into a tap; mark the restarted pan as already moved.
      gesture.current = { kind: 'pan', startView: base, start: remaining, startedAt: 0, moved: true };
      markPanning(base.scale > MIN_SCALE + APPROXIMATE);
    },
    [currentView, markPanning, toggleAt],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>): void => finishPointer(event, false), [finishPointer]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>): void => finishPointer(event, true), [finishPointer]);

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      if (!enabled || isControl(event.target)) return;
      // A touch double-tap already handled this pair; ignore the synthetic
      // dblclick some mobile browsers add afterwards.
      if (Date.now() - taps.current.lastTouchAt <= DOUBLE_TAP_MS) return;
      event.preventDefault();
      event.stopPropagation();
      toggleAt(event.clientX, event.clientY);
    },
    [enabled, toggleAt],
  );

  const onLoad = useCallback((): void => {
    const base = currentView();
    if (base.scale > MIN_SCALE + APPROXIMATE) {
      commit({ mediaId, ...clampView(base, imageRef.current) });
    }
  }, [commit, currentView, mediaId]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!enabled || stage === null) return;
    const onWheel = (event: WheelEvent): void => {
      if (isControl(event.target)) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1);
      const base = viewRef.current.mediaId === mediaId ? viewRef.current : { mediaId, ...IDENTITY };
      const anchor = anchorPoint(event.clientX, event.clientY, stageRef.current);
      const next = base.scale * Math.exp(-delta * WHEEL_RATE);
      commit({ mediaId, ...zoomAround(base, next, anchor, imageRef.current) });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      stage.removeEventListener('wheel', onWheel);
    };
  }, [commit, enabled, mediaId, stageRef]);

  useEffect(() => {
    if (!enabled) return;
    const onResize = (): void => {
      const base = viewRef.current;
      if (base.mediaId !== mediaId || base.scale <= MIN_SCALE + APPROXIMATE) return;
      commit({ mediaId, ...clampView(base, imageRef.current) });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [commit, enabled, mediaId]);

  return {
    attachImage,
    style: { transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` },
    zoomed: view.scale > MIN_SCALE + APPROXIMATE,
    panning,
    canZoomIn: view.scale < MAX_SCALE - APPROXIMATE,
    canZoomOut: view.scale > MIN_SCALE + APPROXIMATE,
    percent: Math.round(view.scale * 100),
    zoomIn,
    zoomOut,
    reset,
    consumeDrag,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onLoad,
  };
}
