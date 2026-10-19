import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { fetchPollResults } from './api';
import { findPollMessage, updateCommentsPoll } from './state';
import type { CommentsThread, PollUpdateTarget } from './state';
import type { MessagePollDto } from './types';
import { usePollVoting } from './usePollVoting';
import type { PollVoting } from './usePollVoting';

/**
The comments screen's poll handling: folds a fresh poll into the pinned post or
a loaded comment, rechecks a short update, and casts votes through the shared
poll action.
*/

export interface CommentsPolling extends PollVoting {
  applyPoll: (target: PollUpdateTarget, poll: MessagePollDto) => void;
  refreshPoll: (target: PollUpdateTarget) => void;
}

export function useCommentsPoll(
  threadRef: RefObject<CommentsThread | null>,
  setThread: Dispatch<SetStateAction<CommentsThread | null>>,
  onError: (failure: unknown) => void,
): CommentsPolling {
  const applyPoll = useCallback(
    (target: PollUpdateTarget, poll: MessagePollDto): void => {
      setThread((current) => updateCommentsPoll(current, target, poll));
    },
    [setThread],
  );

  /**
  A short poll update only asks for a recheck: reload the poll of the loaded
  post or comment it points at, if any, and fold that in. Failures stay silent
  — an out-of-date count settles on the next load or vote.
  */
  const refreshPoll = useCallback(
    (target: PollUpdateTarget): void => {
      const open = threadRef.current;
      if (!open) return;
      const match = findPollMessage([open.post, ...open.comments], target);
      if (!match) return;
      void fetchPollResults(match.chatId, match.id)
        .then((result) => {
          applyPoll({ chatId: match.chatId, messageId: match.id, pollId: result.poll.id }, result.poll);
        })
        .catch(() => {
          // Nothing to surface.
        });
    },
    [applyPoll, threadRef],
  );

  const { votingIds, vote } = usePollVoting(applyPoll, onError);
  return { applyPoll, refreshPoll, votingIds, vote };
}
