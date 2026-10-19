import { useCallback, useState } from 'react';
import { sendVote } from './api';
import type { PollUpdateTarget } from './state';
import type { MessageDto, MessagePollDto } from './types';

/**
The vote half of a poll controller: the ids with a vote in flight, and the
action that casts or retracts one. Shared by the thread and the comments
screen, which both render polls and fold the server's answer the same way.
*/

export interface PollVoting {
  /**
  Message ids with a vote in flight; their poll's answers are disabled.
  */
  votingIds: ReadonlySet<number>;
  /**
  Casts a vote in a poll message: the indexes name the selected answers, or
  `null` retracts the current vote.
  */
  vote: (message: MessageDto, options: number[] | null) => void;
}

export function usePollVoting(
  applyPoll: (target: PollUpdateTarget, poll: MessagePollDto) => void,
  onError: (failure: unknown) => void,
): PollVoting {
  const [votingIds, setVotingIds] = useState<ReadonlySet<number>>(new Set());

  const vote = useCallback(
    (message: MessageDto, options: number[] | null): void => {
      const poll = message.poll;
      if (!poll || votingIds.has(message.id)) return;
      const target: PollUpdateTarget = { chatId: message.chatId, messageId: message.id, pollId: poll.id };
      // No optimistic guess: only the server knows the new counts, and a wrong
      // guess would flicker the bars.
      setVotingIds((current) => new Set(current).add(message.id));
      void sendVote(message.chatId, message.id, options)
        .then((result) => {
          applyPoll(target, result.poll);
        })
        .catch(onError)
        .finally(() => {
          setVotingIds((current) => {
            const next = new Set(current);
            next.delete(message.id);
            return next;
          });
        });
    },
    [applyPoll, votingIds, onError],
  );

  return { votingIds, vote };
}
