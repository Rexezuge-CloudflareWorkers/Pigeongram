import { useCallback, useEffect, useRef } from 'react';
import type { PeerId } from './types';

/**
The debounce between a scroll position and the read receipt it implies.

Scrolling advances the watermark message by message, and every advance is a
round trip, so reports are held back briefly and only the latest one is sent.
The caller is refreshed every render (the `hooks.ts` pattern), which is what
keeps a flushed report pointed at the current shell.
*/

const READ_DEBOUNCE_MS = 250;

export interface ReadWatermarkDebounce {
  schedule: (chatId: PeerId, maxId: number) => void;
  /**
  Sends a report still inside the debounce window, if there is one.
  */
  flush: () => void;
  hasPending: () => boolean;
  reset: () => void;
}

export function useReadWatermark(onReadThrough: (chatId: PeerId, maxId: number) => void): ReadWatermarkDebounce {
  const onReadThroughRef = useRef(onReadThrough);
  useEffect(() => {
    onReadThroughRef.current = onReadThrough;
  });

  const readThrough = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ chatId: PeerId; maxId: number } | null>(null);

  const flush = useCallback((): void => {
    readTimer.current = undefined;
    const pendingRead = pending.current;
    pending.current = null;
    if (pendingRead) onReadThroughRef.current(pendingRead.chatId, pendingRead.maxId);
  }, []);

  const schedule = useCallback(
    (chatId: PeerId, maxId: number): void => {
      if (maxId <= readThrough.current) return;
      readThrough.current = maxId;
      pending.current = { chatId, maxId };
      if (readTimer.current !== undefined) clearTimeout(readTimer.current);
      readTimer.current = setTimeout(flush, READ_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (readTimer.current === undefined) {
        return;
      }

      clearTimeout(readTimer.current);
      flush();
    },
    [flush],
  );

  return {
    schedule,
    flush,
    hasPending: () => readTimer.current !== undefined,
    reset: () => {
      readThrough.current = 0;
    },
  };
}
