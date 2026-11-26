import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPinnedMessages } from './api';
import type { MessageDto, PeerId } from './types';

/**
The pinned list of the open chat: the page the overlay shows and the read
that keeps it current while it is open.

The thread's banner is owned by the thread controller; this controller is
only the overlay's list, read on demand when the reader asks for it. It
watches the thread's pin revision so another device's pin or unpin moves the
open list too, without owning a socket of its own.
*/

/**
How many pinned messages one page reads. Telegram serves the list newest first,
so the first page is also what the reader most likely wants.
*/
const PINNED_PAGE_LIMIT = 50;

interface UsePinnedMessagesOptions {
  /**
  The open chat's id, or null while no thread is open.
  */
  chatId: PeerId | null;
  /**
  Moves on every `message_pinned` the thread folded.
  */
  revision: number;
  /**
  Whether the reader allows pinned reads. Off keeps the list closed and reads
  nothing, even when a pin arrives while the thread is open.
  */
  enabled: boolean;
}

export interface PinnedMessagesController {
  isOpen: boolean;
  messages: readonly MessageDto[];
  loading: boolean;
  loadingOlder: boolean;
  /**
  Why the page could not be read, when it could not.
  */
  error: string | null;
  /**
  Whether a page older than the loaded one may exist.
  */
  hasMore: boolean;
  openList: () => void;
  close: () => void;
  loadOlder: () => void;
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
The list as one value, named by the chat it belongs to. Carrying the chat id
inside the state is what makes a switch safe without a reset effect: a page read
for the chat the reader left simply is not the current value.
*/
interface PinnedView {
  chatId: PeerId;
  open: boolean;
  messages: readonly MessageDto[];
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  nextOffsetId: number | null;
}

export function usePinnedMessages({ chatId, revision, enabled }: UsePinnedMessagesOptions): PinnedMessagesController {
  const [view, setView] = useState<PinnedView | null>(null);
  // Every first-page read takes a ticket: a slow answer for a list the reader
  // already refreshed or left must not paint over the current one.
  const ticket = useRef(0);
  // A revision can move while the list is closed; the reader asked for nothing
  // then, so only an open list pays for the refresh.
  const openRef = useRef(false);
  // Guards the same tick: state alone lets two scroll events start two pages
  // before the first `loadingOlder` commit is visible.
  const olderInFlight = useRef(false);
  const lastRevision = useRef<{ chatId: PeerId | null; revision: number; enabled: boolean }>({ chatId, revision, enabled });

  const openList = useCallback((): void => {
    if (!enabled || chatId === null) return;
    openRef.current = true;
    const sequence = ++ticket.current;
    setView({
      chatId,
      open: true,
      messages: [],
      loading: true,
      loadingOlder: false,
      error: null,
      nextOffsetId: null,
    });
    void fetchPinnedMessages(chatId, { limit: PINNED_PAGE_LIMIT })
      .then((result) => {
        if (sequence !== ticket.current) return;
        setView((current) =>
          current !== null && current.chatId === chatId
            ? {
                ...current,
                messages: result.messages,
                loading: false,
                nextOffsetId: result.nextOffsetId ?? null,
              }
            : current,
        );
      })
      .catch((failure: unknown) => {
        if (sequence !== ticket.current) return;
        setView((current) =>
          current !== null && current.chatId === chatId ? { ...current, loading: false, error: failureText(failure) } : current,
        );
      });
  }, [chatId, enabled]);

  // Another device pinned or unpinned something while the list is open. The
  // page is read in the background, so it keeps showing what it has until the
  // fresh one lands. A switch back on refreshes the hidden list before it
  // reappears, so a pin made while it was off cannot show a stale page.
  useEffect(() => {
    const previous = lastRevision.current;
    lastRevision.current = { chatId, revision, enabled };
    if (!enabled || chatId === null || !openRef.current) return;
    const reenabled = !previous.enabled && enabled;
    if (!reenabled && (previous.chatId !== chatId || revision === previous.revision)) return;
    const sequence = ticket.current;
    void fetchPinnedMessages(chatId, { limit: PINNED_PAGE_LIMIT })
      .then((result) => {
        if (sequence !== ticket.current) return;
        setView((current) =>
          current !== null && current.chatId === chatId && current.open
            ? { ...current, messages: result.messages, nextOffsetId: result.nextOffsetId ?? null }
            : current,
        );
      })
      .catch(() => {
        // A stale list settles on the next open; the reader did not ask for this read.
      });
  }, [revision, chatId, enabled]);

  const close = useCallback((): void => {
    openRef.current = false;
    setView((current) => (current !== null && current.open ? { ...current, open: false } : current));
  }, []);

  const loadOlder = useCallback((): void => {
    if (
      !enabled ||
      chatId === null ||
      view === null ||
      view.chatId !== chatId ||
      view.nextOffsetId === null ||
      view.loadingOlder ||
      olderInFlight.current
    ) {
      return;
    }
    olderInFlight.current = true;
    const sequence = ticket.current;
    const offsetId = view.nextOffsetId;
    setView((current) => (current !== null && current.chatId === chatId ? { ...current, loadingOlder: true } : current));
    void fetchPinnedMessages(chatId, { limit: PINNED_PAGE_LIMIT, offsetId })
      .then((result) => {
        if (sequence !== ticket.current) return;
        setView((current) => {
          if (current === null || current.chatId !== chatId) return current;
          const seen = new Set(current.messages.map((message) => message.id));
          return {
            ...current,
            messages: [...current.messages, ...result.messages.filter((message) => !seen.has(message.id))],
            nextOffsetId: result.nextOffsetId ?? null,
            loadingOlder: false,
          };
        });
      })
      .catch((failure: unknown) => {
        if (sequence !== ticket.current) return;
        setView((current) =>
          current !== null && current.chatId === chatId ? { ...current, loadingOlder: false, error: failureText(failure) } : current,
        );
      })
      .finally(() => {
        olderInFlight.current = false;
      });
  }, [chatId, view, enabled]);

  // The switch hides the list without writing state: turning it back on finds
  // the same view, refreshed by the effect above.
  const current = enabled && view !== null && view.chatId === chatId ? view : null;
  return {
    isOpen: current?.open ?? false,
    messages: current?.messages ?? [],
    loading: current?.loading ?? false,
    loadingOlder: current?.loadingOlder ?? false,
    error: current?.error ?? null,
    hasMore: current?.nextOffsetId !== null && current?.nextOffsetId !== undefined,
    openList,
    close,
    loadOlder,
  };
}
