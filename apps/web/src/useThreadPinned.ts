import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { fetchPinnedMessages, setMessagePinned } from './api';
import { applyThreadMessagePinned, applyThreadPinnedMessage } from './thread-state';
import type { ChatThread } from './thread-state';
import type { MessageDto, PeerId, UpdateEvent } from './types';

/**
 * The thread's message pins: the banner's body, the write, and the fold of the
 * live `message_pinned` update.
 *
 * Split from `useThread` to keep it under the god-file cap. The banner is the
 * newest pinned message, which only a read can name; the update and the write
 * answer carry ids alone, so both re-read the first pinned page beside the
 * fold.
 */

type MessagePinUpdate = Extract<UpdateEvent, { type: 'message_pinned' }>;

interface UseThreadPinnedOptions {
  setThread: Dispatch<SetStateAction<ChatThread | null>>;
  /**
   * The open thread as the socket handler last saw it: the handler is created
   * once, so it reads the thread through a ref rather than a closed-over value.
   */
  threadRef: RefObject<ChatThread | null>;
  onError: (error: unknown) => void;
}

interface ThreadPins {
  /**
   * How many message-pin changes the thread has seen. The pinned list watches
   * it so an open list follows another device's pin or unpin without owning the
   * socket.
   */
  revision: number;
  /**
   * Folds a live `message_pinned` update, when it belongs to the open thread.
   */
  fold: (update: MessagePinUpdate) => void;
  /**
   * Pins a message in its chat, or unpins it. Not optimistic: a pin is a
   * chat-wide state that other clients see at once, so the banner and the menu
   * follow the server's answer (and its `message_pinned` echo) instead of a
   * guess.
   */
  setPinned: (message: MessageDto, pinned: boolean) => void;
}

export function useThreadPinned({ setThread, threadRef, onError }: UseThreadPinnedOptions): ThreadPins {
  const [revision, setRevision] = useState(0);

  /**
  Re-reads the chat's newest pinned message for its banner. The update and the
  write answer name ids only, so the body has to come from Telegram; a banner
  is not worth an error toast, and the next open reads it again.
  */
  const refresh = useCallback(
    (chatId: PeerId): void => {
      void fetchPinnedMessages(chatId, { limit: 1 })
        .then((result) => {
          setThread((current) => applyThreadPinnedMessage(current, chatId, result.messages[0] ?? null));
        })
        .catch(() => {
          // A stale banner settles on the next open.
        });
    },
    [setThread],
  );

  const fold = useCallback(
    (update: MessagePinUpdate): void => {
      // The chat is named for channels and supergroups; the account-level step
      // carries no peer, so an id already loaded is what proves the fold
      // belongs to this thread.
      const open = threadRef.current;
      const applies =
        update.chatId === null
          ? open !== null &&
            update.messageIds.some((id) => open.messages.some((message) => message.id === id) || open.pinnedMessage?.id === id)
          : open?.chat.id === update.chatId;
      if (!applies) return;
      setThread((current) => applyThreadMessagePinned(current, update.chatId, update.messageIds, update.pinned));
      setRevision((current) => current + 1);
      const chatId = update.chatId ?? open?.chat.id ?? null;
      if (chatId !== null) refresh(chatId);
    },
    [refresh, setThread, threadRef],
  );

  const setPinned = useCallback(
    (message: MessageDto, pinned: boolean): void => {
      setMessagePinned(message.chatId, message.id, pinned)
        .then((result) => {
          setThread((current) => applyThreadMessagePinned(current, result.chatId, [result.messageId], result.pinned));
          setRevision((current) => current + 1);
          refresh(result.chatId);
        })
        .catch(onError);
    },
    [onError, refresh, setThread],
  );

  // One stable value: the thread's `applyUpdate` carries it in its deps, and it
  // is created once for the socket.
  return useMemo(() => ({ revision, fold, setPinned }), [revision, fold, setPinned]);
}
