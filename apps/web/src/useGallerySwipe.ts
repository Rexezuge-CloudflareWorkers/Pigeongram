import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { followOffset, swipeAxis, swipeDirection, type SwipeAxis } from './gallery-swipe';
import { capturePointer, isControl, releasePointer } from './pointer';

/**
 * Horizontal swipe navigation for the media viewer's gallery.
 *
 * The track follows the finger while the gesture is horizontal and at the
 * photo's 1x view; releasing past the threshold asks for the neighbour and
 * anything shorter settles back to rest. The offset is stored with the media
 * id, as the zoom view is, so when the gallery commits to another item the new
 * media mounts at rest without a reset render.
 *
 * A second pointer (a pinch) and a mostly-vertical drag end the gesture, and a
 * press on a control never starts one. The panning photo keeps its own
 * gestures: the viewer disables this hook while the photo is zoomed.
 */

interface UseGallerySwipeOptions {
  enabled: boolean;
  /**
   * The current message id; changing it discards the previous offset.
   */
  mediaId: number | null;
  canPrev: boolean;
  canNext: boolean;
  onSwipe: (direction: 1 | -1) => void;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  axis: SwipeAxis | null;
}

interface OffsetState {
  mediaId: number | null;
  offset: number;
  settling: boolean;
}

export interface GallerySwipe {
  /**
  The track's follow translation, or undefined when the media is not swipeable.
  */
  style: CSSProperties | undefined;
  /**
  Whether the track is returning to rest and should animate that return.
  */
  settling: boolean;
  /**
   * Whether the last pointer sequence moved the media. The viewer's backdrop
   * click uses this so a short swipe never closes the dialog.
   */
  consumeDrag: () => boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function useGallerySwipe({ enabled, mediaId, canPrev, canNext, onSwipe }: UseGallerySwipeOptions): GallerySwipe {
  const [stored, setStored] = useState<OffsetState>({ mediaId, offset: 0, settling: false });
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);

  const offset = enabled && stored.mediaId === mediaId ? stored.offset : 0;
  const settling = enabled && stored.mediaId === mediaId && stored.settling;

  const reset = useCallback((): void => {
    setStored({ mediaId, offset: 0, settling: true });
  }, [mediaId]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (!enabled || event.pointerType === 'mouse' || isControl(event.target)) return;
      if (drag.current !== null) {
        // A second finger is a pinch, not a swipe: hand the gesture to the
        // browser and let the track settle back.
        drag.current = null;
        dragged.current = true;
        reset();
        return;
      }
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, axis: null };
    },
    [enabled, reset],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const active = drag.current;
      if (!enabled || active === null || active.pointerId !== event.pointerId) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      if (active.axis === null) {
        const axis = swipeAxis(dx, dy);
        if (axis === null) return;
        dragged.current = true;
        if (axis === 'vertical') {
          // Leave a vertical gesture alone; it is not the gallery's to follow.
          drag.current = null;
          return;
        }
        active.axis = 'horizontal';
        capturePointer(event.currentTarget, event.pointerId);
      }
      setStored({ mediaId, offset: followOffset(dx, canPrev, canNext), settling: false });
    },
    [canNext, canPrev, enabled, mediaId],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean): void => {
      const active = drag.current;
      if (active === null || active.pointerId !== event.pointerId) return;
      drag.current = null;
      releasePointer(event.currentTarget, event.pointerId);
      if (active.axis !== 'horizontal') return;
      const step = cancelled ? null : swipeDirection(event.clientX - active.startX, event.clientY - active.startY);
      if ((step === 1 && canNext) || (step === -1 && canPrev)) {
        // The offset is keyed to the old media id, so the neighbour mounts at
        // rest; resetting it also protects a callback that keeps the item.
        setStored({ mediaId, offset: 0, settling: false });
        onSwipe(step);
        return;
      }
      reset();
    },
    [canNext, canPrev, onSwipe, reset],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>): void => finish(event, false), [finish]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>): void => finish(event, true), [finish]);

  const consumeDrag = useCallback((): boolean => {
    const moved = dragged.current;
    dragged.current = false;
    return moved;
  }, []);

  return {
    style: enabled ? { transform: `translate3d(${offset}px, 0, 0)` } : undefined,
    settling,
    consumeDrag,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
