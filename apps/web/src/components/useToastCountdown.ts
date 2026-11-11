import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How often the countdown bar repaints. A tick is a state update, so it stays
 * coarse enough to be cheap but fine enough that the bar reads as continuous.
 */
const TICK_MS = 50;

interface ToastCountdown {
  /**
   * The share of the duration still left, from 1 down to 0.
   */
  progress: number;
  /**
   * Freezes the countdown (bar and timer together) where it is.
   */
  pause: () => void;
  /**
   * Continues a paused countdown from the point it stopped.
   */
  resume: () => void;
}

/**
 * The auto-dismiss countdown behind a toast. The bar is the visible half and
 * the timer the functional one, so they share a single clock: hovering freezes
 * both, and leaving resumes both from the same remaining time.
 *
 * `token` identifies the toast on screen; it is the slot's clock, not its text.
 * A new token restarts the countdown (and the bar) from full even when the
 * message repeats, and null stops the timer and leaves the bar where the exit
 * found it, so the toast's fade-out does not jump back to full.
 */
export function useToastCountdown(token: number | null, durationMs: number, onElapsed: () => void): ToastCountdown {
  const [progress, setProgress] = useState(1);
  const [paused, setPaused] = useState(false);
  const [trackedToken, setTrackedToken] = useState(token);
  const remainingRef = useRef(durationMs);
  const elapsedRef = useRef(onElapsed);

  // A new toast restarts the bar from full before the timer effect below runs.
  // Guarded setState during render is the established pattern in this repo
  // (`useExitAnimation` does the same) and avoids a cascading effect render.
  if (trackedToken !== token) {
    setTrackedToken(token);
    if (token !== null) {
      setProgress(1);
      setPaused(false);
    }
  }

  // The callback usually closes over a fresh render's props. Keeping it in a
  // ref lets the timer read the latest one without restarting the countdown.
  useEffect(() => {
    elapsedRef.current = onElapsed;
  }, [onElapsed]);

  // A new slot starts a full duration; a pause/resume of the same slot keeps
  // whatever remaining time the last tick recorded.
  useEffect(() => {
    if (token !== null) remainingRef.current = durationMs;
  }, [token, durationMs]);

  useEffect(() => {
    if (token === null || paused) return;
    const startedAt = Date.now();
    const startedWith = remainingRef.current;
    const tick = (): void => {
      const remaining = Math.max(0, startedWith - (Date.now() - startedAt));
      remainingRef.current = remaining;
      setProgress(remaining / durationMs);
      if (remaining > 0) return;
      clearInterval(id);
      elapsedRef.current();
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [token, durationMs, paused]);

  const pause = useCallback((): void => setPaused(true), []);
  const resume = useCallback((): void => setPaused(false), []);

  return { progress, pause, resume };
}
