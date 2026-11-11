import { useCallback } from 'react';
import type { MessageDto, PeerId } from './types';

/**
The chat list's half of a deletion it did not witness.

A deletion in the open thread is folded by the thread first, which is the only
place that can say what left the window and what it still holds: ids alone
cannot tell whether the chat's own last message was among them. This turns that
report into the list's `applyDeleted`, whose ids are the removed ones.
*/

type ApplyDeleted = (
  chatId: PeerId,
  messageIds: readonly number[],
  removed: readonly MessageDto[],
  remaining: readonly MessageDto[],
) => void;

export function useDeletionReport(
  applyDeleted: ApplyDeleted,
): (chatId: PeerId, removed: readonly MessageDto[], remaining: readonly MessageDto[]) => void {
  return useCallback(
    (chatId, removed, remaining) => {
      applyDeleted(
        chatId,
        removed.map((message) => message.id),
        removed,
        remaining,
      );
    },
    [applyDeleted],
  );
}
