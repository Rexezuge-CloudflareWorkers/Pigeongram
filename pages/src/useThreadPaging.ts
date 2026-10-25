import { useCallback, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { fetchHistory } from './api';
import { mergeMessages } from './state';
import { threadReachesLatest } from './thread-state';
import type { ChatThread } from './thread-state';
import { newerWindow, WINDOW_LIMIT } from './thread-window';

/**
 * The thread's two paging directions. Kept in their own hook so the controller
 * stays under the god-file cap and the "older" and "newer" cursors sit beside
 * each other: `loadOlder` prepends from the oldest row, while `loadNewer`
 * continues from the end of the contiguous window, not from whatever a send or
 * a held live message has appended beyond it.
 */
interface UseThreadPagingOptions {
  threadRef: RefObject<ChatThread | null>;
  setThread: Dispatch<SetStateAction<ChatThread | null>>;
  setError: (message: string | null) => void;
}

export interface ThreadPaging {
  loadingOlder: boolean;
  loadingNewer: boolean;
  loadOlder: () => Promise<void>;
  loadNewer: () => Promise<void>;
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function useThreadPaging({ threadRef, setThread, setError }: UseThreadPagingOptions): ThreadPaging {
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  // A page in flight, tracked outside React state so a scroll event and the
  // button cannot both start one before the disabled state paints.
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);

  const loadOlder = useCallback(async (): Promise<void> => {
    // The scroll handler and the button both call this; the in-flight ref is
    // what keeps a burst of scroll events to one page.
    const open = threadRef.current;
    const chat = open?.chat;
    const oldest = open?.messages[0];
    if (!open || !chat || !oldest || !open.hasMoreOlder || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setError(null);
    try {
      const result = await fetchHistory(chat.id, {
        limit: WINDOW_LIMIT,
        offsetId: oldest.id,
        // The bridge speaks unix seconds; the DTO carries milliseconds.
        offsetDate: Math.floor(oldest.date / 1000),
      });
      setThread((current) =>
        current && current.chat.id === chat.id
          ? {
              ...current,
              messages: mergeMessages(current.messages, result.messages),
              // A short page is the oldest one Telegram has.
              hasMoreOlder: result.messages.length >= WINDOW_LIMIT,
            }
          : current,
      );
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [threadRef, setThread, setError]);

  const loadNewer = useCallback(async (): Promise<void> => {
    const open = threadRef.current;
    const chat = open?.chat;
    const end = open?.windowEndId;
    // The loaded range already reaching the newest message has nothing to
    // read forward to; only a gap or a backlog offers this page.
    if (!open || !chat || end === null || end === undefined || threadReachesLatest(open) || loadingNewerRef.current) return;
    loadingNewerRef.current = true;
    setLoadingNewer(true);
    setError(null);
    try {
      const result = await fetchHistory(chat.id, { limit: WINDOW_LIMIT, ...newerWindow(end) });
      const pageEnd = result.messages.reduce((newest, message) => Math.max(newest, message.id), end);
      setThread((current) => {
        if (!current || current.chat.id !== chat.id) return current;
        // An empty page means the window was already at the end of the chat;
        // jumping the cursor to the newest known id stops the control from
        // asking for the same empty page again.
        const windowEndId =
          pageEnd > end ? Math.max(current.windowEndId ?? end, pageEnd) : (current.latestMessageId ?? current.windowEndId ?? end);
        return { ...current, messages: mergeMessages(current.messages, result.messages), windowEndId };
      });
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      loadingNewerRef.current = false;
      setLoadingNewer(false);
    }
  }, [threadRef, setThread, setError]);

  return { loadingOlder, loadingNewer, loadOlder, loadNewer };
}
