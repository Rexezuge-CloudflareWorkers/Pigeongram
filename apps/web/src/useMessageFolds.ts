import { useCallback } from 'react';
import type { MessageDto, PeerId, UpdateEvent } from './types';
import { useDeletionReport } from './useDeletionReport';

/**
The shell's folds of the thread's own writes into the chat list: a sent
message, an accepted edit and a folded deletion.

The thread keeps its own copy of each; the list only needs the preview and the
badge repaired. Split from `SignedInShell.tsx` so the shell stays under the
god-file cap, and so the three folds are read beside the list they repair.
*/
interface MessageFolds {
  /**
  A message the caller sent (or uploaded) was accepted: fold it into the
  dialogs.
  */
  onSent: (message: MessageDto) => void;
  /**
  A message the caller edited was accepted: the preview and badge follow the
  server's copy, exactly as they follow a live edit from another device.
  */
  onEdited: (message: MessageDto) => void;
  /**
  The open thread folded a deletion: what left the window and what it still
  holds repair the list ahead of the engine's echo.
  */
  onDeleted: (chatId: PeerId, removed: readonly MessageDto[], remaining: readonly MessageDto[]) => void;
}

export function useMessageFolds(
  applyUpdate: (update: UpdateEvent, activeChatId: PeerId | null) => void,
  applyDeleted: (chatId: PeerId, messageIds: readonly number[], removed: readonly MessageDto[], remaining: readonly MessageDto[]) => void,
): MessageFolds {
  const onSent = useCallback(
    (message: MessageDto): void => {
      applyUpdate({ type: 'new_message', message }, message.chatId);
    },
    [applyUpdate],
  );

  const onEdited = useCallback(
    (message: MessageDto): void => {
      applyUpdate({ type: 'edit_message', message }, message.chatId);
    },
    [applyUpdate],
  );

  const onDeleted = useDeletionReport(applyDeleted);

  return { onSent, onEdited, onDeleted };
}
