import { useEffect, useState } from 'react';

/**
 * The swipe-to-reply and reaction-burst state for a message row.
 * Kept in a hook so the row stays under the god-file cap: the horizontal
 * drag translates the bubble until it crosses the reply threshold, then the
 * reply fires and the offset resets. The burst marker is the reaction the
 * last tap adopted; it fades out after one frame timeout.
 */
const SWIPE_REPLY_PX = 56;
const BURST_MS = 340;

export function useMessageGestures(): {
  swipeOffset: number;
  burstKey: string | null;
  dragReply: (dx: number, onReply: () => void) => void;
  resetSwipe: () => void;
  burst: (key: string) => void;
} {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [burstKey, setBurstKey] = useState<string | null>(null);

  useEffect(() => {
    if (burstKey === null) return;
    const timer = setTimeout(() => setBurstKey(null), BURST_MS);
    return () => clearTimeout(timer);
  }, [burstKey]);

  const dragReply = (dx: number, onReply: () => void): void => {
    if (dx <= 0) return;
    const offset = Math.min(dx * 0.35, SWIPE_REPLY_PX);
    setSwipeOffset(offset);
    if (dx < SWIPE_REPLY_PX) {
      return;
    }

    onReply();
    setSwipeOffset(0);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(10);
    }
  };

  const resetSwipe = (): void => setSwipeOffset(0);
  const burst = (key: string): void => {
    setBurstKey(key);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(10);
    }
  };

  return { swipeOffset, burstKey, dragReply, resetSwipe, burst };
}
