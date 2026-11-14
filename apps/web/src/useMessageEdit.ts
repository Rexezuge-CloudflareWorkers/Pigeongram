import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { editMessage } from './api';
import { applyThreadEdit } from './thread-state';
import type { ChatThread } from './thread-state';
import type { MessageDto, PeerId } from './types';

/**
The thread's edit controller: which message the composer is editing and the
call that replaces its text.

Split from `useThread.ts` so the hook stays under the god-file cap, the same
shape as `useMessageDelete`. The controller owns no window of its own: the
answer is folded through the thread's `setThread`, and the chat list is handed
the same server copy the fold used.
*/
interface MessageEditController {
  /**
  The message the composer is editing, or null while it is composing a new
  message. Telegram edits one message at a time, so the target is a single
  DTO rather than a list.
  */
  editing: MessageDto | null;
  /**
  Starts editing a message's text. The reply target is the view's, so the view
  clears it before calling this.
  */
  startEdit: (message: MessageDto) => void;
  cancelEdit: () => void;
  /**
  Replaces the edited message's text. The composer keeps its draft until this
  answers, so a refusal costs nothing.
  */
  saveEdit: (text: string) => Promise<void>;
  /**
  Forgets the target when the thread it belonged to closes.
  */
  reset: () => void;
  /**
  Refreshes an open editor from a live edit of the same message: its Save must
  not overwrite what the reader never saw.
  */
  refresh: (message: MessageDto) => void;
  /**
  Closes the editor when the message it edits is deleted, on any device.
  */
  forget: (chatId: PeerId | null, messageIds: readonly number[]) => void;
}

interface UseMessageEditOptions {
  setThread: Dispatch<SetStateAction<ChatThread | null>>;
  /**
  The edit was accepted: the chat list's preview is repaired from the server's
  copy, exactly as a live edit from another device would repair it.
  */
  onEdited: (message: MessageDto) => void;
  onError: (error: unknown) => void;
}

export function useMessageEdit({ setThread, onEdited, onError }: UseMessageEditOptions): MessageEditController {
  const [editing, setEditing] = useState<MessageDto | null>(null);

  // The socket handler is created once, so the edit target is read through a
  // ref: a live edit refreshes the open editor, and a delete closes it.
  const editingRef = useRef<MessageDto | null>(null);
  useLayoutEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const startEdit = useCallback((message: MessageDto): void => {
    setEditing(message);
  }, []);

  const cancelEdit = useCallback((): void => {
    setEditing(null);
  }, []);

  const reset = useCallback((): void => {
    setEditing(null);
  }, []);

  const refresh = useCallback((message: MessageDto): void => {
    setEditing((current) => (current !== null && current.id === message.id ? message : current));
  }, []);

  const forget = useCallback((chatId: PeerId | null, messageIds: readonly number[]): void => {
    setEditing((current) => {
      if (current === null || !messageIds.includes(current.id)) return current;
      return chatId === null || chatId === current.chatId ? null : current;
    });
  }, []);

  const saveEdit = useCallback(
    (text: string): Promise<void> => {
      const target = editingRef.current;
      if (target === null) return Promise.resolve();
      const next = text.trim();
      // Telegram refuses an edit that changes nothing (`MESSAGE_NOT_MODIFIED`),
      // and a blank text is no message at all: both close the editor as if the
      // reader had cancelled, without spending a round trip.
      if (next.length === 0 || next === target.text.trim()) {
        setEditing(null);
        return Promise.resolve();
      }
      return editMessage(target.chatId, target.id, next)
        .then((result) => {
          setThread((current) => applyThreadEdit(current, result.message));
          setEditing(null);
          onEdited(result.message);
        })
        .catch((failure: unknown) => {
          onError(failure);
        });
    },
    [setThread, onEdited, onError],
  );

  return { editing, startEdit, cancelEdit, saveEdit, reset, refresh, forget };
}
