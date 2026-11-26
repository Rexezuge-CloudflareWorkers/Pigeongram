import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sendReaction } from './api';
import { toggleReaction } from './state';
import type { MessageDto, MessageReactionDto } from './types';

/**
The one optimistic reaction toggle, shared by the thread and the comments.

Both screens send the same RPC, hold the same in-flight set, and fold the same
optimistic result into a different message list. The only difference is where
the fold lands, so that is the port this hook takes; the ordering — flip now,
replace with the server's answer, restore on refusal, clear in flight — lives
here once.
*/
export interface ReactionTogglePorts {
  enabled?: boolean;
  reactingIds: ReadonlySet<number>;
  setReactingIds: Dispatch<SetStateAction<ReadonlySet<number>>>;
  apply: (message: MessageDto, list: MessageReactionDto[]) => void;
  onError: (failure: unknown) => void;
}

export function useReactionToggle({
  enabled = true,
  reactingIds,
  setReactingIds,
  apply,
  onError,
}: ReactionTogglePorts): (message: MessageDto, reaction: MessageReactionDto) => void {
  return useCallback(
    (message: MessageDto, reaction: MessageReactionDto): void => {
      if (!enabled || reactingIds.has(message.id)) return;
      if (!reaction.chosen && reaction.emoji === null && reaction.customEmojiId === null) return;
      const before = message.reactions;
      const after = toggleReaction(before, reaction);
      apply(message, after);
      setReactingIds((current) => new Set(current).add(message.id));
      const target = reaction.chosen
        ? null
        : reaction.emoji === null
          ? { customEmojiId: reaction.customEmojiId as string }
          : { emoji: reaction.emoji };
      void sendReaction(message.chatId, message.id, target)
        .then((result) => {
          if (result.message) apply(message, result.message.reactions);
        })
        .catch((failure: unknown) => {
          apply(message, before);
          onError(failure);
        })
        .finally(() => {
          setReactingIds((current) => {
            const next = new Set(current);
            next.delete(message.id);
            return next;
          });
        });
    },
    [enabled, reactingIds, setReactingIds, apply, onError],
  );
}
