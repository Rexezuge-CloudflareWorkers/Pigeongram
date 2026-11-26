import { useCallback, useRef, useState } from 'react';
import { deleteScheduledMessages, fetchScheduledMessages, sendMessage, sendScheduled } from './api';
import { failureText } from './failure';
import { randomMessageId } from './outbox';
import { applyScheduledEvent, mergeScheduledMessages } from './scheduled-state';
import type { MessageDto, PeerId, UpdateEvent } from './types';

/**
The open chat's scheduled queue: the list the overlay shows and the writes that
act on it.

Like the pinned list, this is read on demand — a thread open never pays for a
queue the reader did not ask for. The queue lives beside the thread rather than
inside `ChatThread.messages` or `DialogDto.lastMessage`: a queued message has a
future date and no place in the history's ids, watermarks or reply lookups.
Every fold is keyed by id, so the engine's echo and Telegram's raw update for
the same change are safe to apply twice.
*/

export interface ScheduledMessagesController {
  isOpen: boolean;
  messages: readonly MessageDto[];
  loading: boolean;
  error: string | null;
  /**
  Ids with a send-now or delete request in flight.
  */
  busyIds: ReadonlySet<number>;
  openList: () => void;
  close: () => void;
  /**
  Folds an event pushed over the updates socket.
  */
  apply: (update: UpdateEvent) => void;
  /**
  Queues a text message for a future time.
  */
  schedule: (text: string, scheduleDate: number, replyTo?: number) => Promise<void>;
  /**
  Sends a queued message immediately.
  */
  sendNow: (message: MessageDto) => Promise<void>;
  /**
  Drops a queued message without sending it.
  */
  remove: (message: MessageDto) => Promise<void>;
  /**
  Folds an accepted edit of a queued message.
  */
  edited: (message: MessageDto) => void;
}

interface UseScheduledMessagesOptions {
  chatId: PeerId | null;
  /**
  A preview chat has no write affordances, including scheduling.
  */
  enabled: boolean;
  onError: (error: unknown) => void;
  /**
  A scheduled message that Telegram has just sent becomes an ordinary one.
  */
  onSent: (message: MessageDto) => void;
  /**
  Hands a queued message to the composer's edit mode.
  */
  onEdit: (message: MessageDto) => void;
}

interface ScheduledView {
  chatId: PeerId;
  open: boolean;
  messages: readonly MessageDto[];
  loading: boolean;
  error: string | null;
  busyIds: ReadonlySet<number>;
}

export function useScheduledMessages({
  chatId,
  enabled,
  onError,
  onSent,
  onEdit,
}: UseScheduledMessagesOptions): ScheduledMessagesController {
  const [view, setView] = useState<ScheduledView | null>(null);
  // A slow read for a list the reader refreshed or left must not paint over the
  // current one, and a switch of chat invalidates it just as surely.
  const ticket = useRef(0);
  const busyRef = useRef(false);

  const fold = useCallback((chat: PeerId, update: UpdateEvent): void => {
    setView((current) => {
      // A write can land while the overlay is closed. Keep its queue beside the
      // thread so opening the list later starts from what the socket already
      // told us, rather than from an empty view.
      const base: ScheduledView =
        current !== null && current.chatId === chat
          ? current
          : { chatId: chat, open: false, messages: [], loading: false, error: null, busyIds: EMPTY_IDS };
      const messages = applyScheduledEvent(base.messages, update);
      return messages === null ? base : { ...base, messages };
    });
  }, []);

  const apply = useCallback(
    (update: UpdateEvent): void => {
      if (chatId === null || !enabled) return;
      if ((update.type === 'scheduled_new' || update.type === 'scheduled_edit') && update.message.chatId === chatId) {
        fold(chatId, update);
      } else if (update.type === 'scheduled_deleted' && update.chatId === chatId) {
        fold(chatId, update);
        for (const message of update.sentMessages ?? []) onSent(message);
      }
    },
    [chatId, enabled, fold, onSent],
  );

  const openList = useCallback((): void => {
    if (!enabled || chatId === null) return;
    const sequence = ++ticket.current;
    setView((current) => ({
      chatId,
      open: true,
      messages: current?.chatId === chatId ? current.messages : [],
      loading: true,
      error: null,
      busyIds: new Set(),
    }));
    void fetchScheduledMessages(chatId)
      .then((result) => {
        if (sequence !== ticket.current) return;
        setView((current) =>
          current !== null && current.chatId === chatId
            ? { ...current, messages: mergeScheduledMessages(current.messages, result.messages), loading: false }
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

  const close = useCallback((): void => {
    setView((current) => (current !== null && current.open ? { ...current, open: false } : current));
  }, []);

  const schedule = useCallback(
    (text: string, scheduleDate: number, replyTo?: number): Promise<void> => {
      if (!enabled || chatId === null) return Promise.resolve();
      return sendMessage(chatId, text, replyTo, randomMessageId(), scheduleDate)
        .then((result) => {
          if (chatId === null) return;
          fold(chatId, { type: 'scheduled_new', message: result.message });
        })
        .catch((failure: unknown) => {
          onError(failure);
        });
    },
    [chatId, enabled, fold, onError],
  );

  const act = useCallback(
    (message: MessageDto, run: () => Promise<{ messageIds: number[]; messages?: MessageDto[] }>): Promise<void> => {
      if (!enabled || chatId === null || busyRef.current) return Promise.resolve();
      busyRef.current = true;
      const chat = chatId;
      const busyIds = new Set([message.id]);
      setView((current) => (current !== null && current.chatId === chat ? { ...current, busyIds, error: null } : current));
      return run()
        .then((result) => {
          fold(chat, { type: 'scheduled_deleted', chatId: chat, messageIds: result.messageIds, sentMessages: result.messages });
          for (const sent of result.messages ?? []) onSent(sent);
        })
        .catch((failure: unknown) => {
          setView((current) => (current !== null && current.chatId === chat ? { ...current, error: failureText(failure) } : current));
          onError(failure);
        })
        .finally(() => {
          busyRef.current = false;
          setView((current) => (current !== null && current.chatId === chat ? { ...current, busyIds: new Set() } : current));
        });
    },
    [chatId, enabled, fold, onError, onSent],
  );

  const sendNow = useCallback(
    (message: MessageDto): Promise<void> => act(message, () => sendScheduled(message.chatId, [message.id])),
    [act],
  );

  const remove = useCallback(
    (message: MessageDto): Promise<void> => act(message, async () => deleteScheduledMessages(message.chatId, [message.id])),
    [act],
  );

  const edited = useCallback(
    (message: MessageDto): void => {
      if (chatId === null || message.chatId !== chatId) return;
      onEdit(message);
    },
    [chatId, onEdit],
  );

  const current = enabled && view !== null && view.chatId === chatId ? view : null;
  return {
    isOpen: current?.open ?? false,
    messages: current?.messages ?? [],
    loading: current?.loading ?? false,
    error: current?.error ?? null,
    busyIds: current?.busyIds ?? EMPTY_IDS,
    openList,
    close,
    apply,
    schedule,
    sendNow,
    remove,
    edited,
  };
}

const EMPTY_IDS: ReadonlySet<number> = new Set();
