import { useCallback, useRef, useState } from 'react';
import { deleteMessages } from './api';
import type { MessageDto, PeerId } from './types';

/**
The confirm-then-delete flow, shared by the thread and the comments screen.

The dialog's open state lives here rather than in either view: both screens
offer the same action on the same kind of display group (a message, or an album
and its members), and the shell renders the one dialog from whichever
controller is on screen.

A delete is optimistic — the rows go before Telegram answers, as they do in the
official clients — and a refused one puts them back. Nothing else folds the
removal: the engine echoes the accepted ids as a `deleted` update, so the chat
list's preview and badge are repaired by the same path that carries a deletion
made from another device.
*/

export interface MessageDeletion {
  /**
  The display group awaiting confirmation, oldest first, or null while the
  dialog is closed.
  */
  messages: readonly MessageDto[] | null;
  /**
  Asks for a display group to be deleted: this is the menu's action, and it
  only opens the confirmation.
  */
  request: (messages: readonly MessageDto[]) => void;
  /**
  Closes the confirmation without touching anything.
  */
  cancel: () => void;
  /**
  Deletes the confirmed group for everyone.
  */
  confirm: () => void;
}

interface UseMessageDeleteOptions {
  /**
  Removes the messages from the open window, before Telegram answers.
  */
  remove: (chatId: PeerId, messageIds: readonly number[]) => void;
  /**
  Puts the messages a failed delete took out back where they were.
  */
  restore: (messages: readonly MessageDto[]) => void;
  /**
  Reports a refused delete to the global toast.
  */
  onError: (error: unknown) => void;
}

export function useMessageDelete({ remove, restore, onError }: UseMessageDeleteOptions): MessageDeletion {
  const [messages, setMessages] = useState<readonly MessageDto[] | null>(null);
  // The target is also kept outside state: `confirm` runs from a click handler
  // that must not depend on a render having committed the `request` before it.
  const target = useRef<readonly MessageDto[] | null>(null);

  const request = useCallback((group: readonly MessageDto[]): void => {
    if (group.length === 0) return;
    target.current = group;
    setMessages(group);
  }, []);

  const cancel = useCallback((): void => {
    target.current = null;
    setMessages(null);
  }, []);

  const confirm = useCallback((): void => {
    const group = target.current;
    if (group === null) return;
    target.current = null;
    setMessages(null);
    const chatId = group[0].chatId;
    const messageIds = group.map((message) => message.id);
    remove(chatId, messageIds);
    void deleteMessages(chatId, messageIds).catch((failure: unknown) => {
      restore(group);
      onError(failure);
    });
  }, [remove, restore, onError]);

  return { messages, request, cancel, confirm };
}
