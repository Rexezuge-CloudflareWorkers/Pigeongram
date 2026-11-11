import type { DialogDto, PeerId } from '../types';

/**
Folds a chat's pin state into its list.

Pinning moves the chat to the top of the pinned block; unpinning drops it at
the top of the unpinned block, just below the chats that remain pinned. The
list's natural order is the activity order, and a chat that was pinned is
usually the one that was just active, so the boundary is the right place for
it. An unknown chat or a state the row already has is a no-op.

Split from `state/index.ts` to keep that module under the god-file cap, like
the deletion folds beside it; `useDialogs` and the state tests import it
directly.
*/
export function applyPinnedDialog(dialogs: DialogDto[], chatId: PeerId, pinned: boolean): DialogDto[] {
  const index = dialogs.findIndex((dialog) => dialog.chat.id === chatId);
  if (index === -1) return dialogs;
  const dialog = dialogs[index];
  if (dialog.pinned === pinned) return dialogs;
  const rest = dialogs.filter((_, candidateIndex) => candidateIndex !== index);
  const updated: DialogDto = { ...dialog, pinned };
  if (pinned) {
    rest.unshift(updated);
  } else {
    const pinnedCount = rest.filter((candidate) => candidate.pinned).length;
    rest.splice(pinnedCount, 0, updated);
  }
  return rest;
}
