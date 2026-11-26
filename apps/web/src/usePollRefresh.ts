import { useCallback } from 'react';
import { fetchPollResults } from './api';
import { findPollMessage } from './state';
import type { PollUpdateTarget } from './state';
import type { MessageDto, MessagePollDto } from './types';

/**
A short poll update asks for a recheck, not for a message to render.

The thread and the comments screen both look the target up in the messages
they have loaded, read the current results and fold them in. Only the source
of the loaded messages differs, so that is the port; a failed recheck stays
silent because the next load or vote will settle the count.
*/
export function usePollRefresh(
  loadedMessages: () => readonly MessageDto[],
  applyPoll: (target: PollUpdateTarget, poll: MessagePollDto) => void,
): (target: PollUpdateTarget) => void {
  return useCallback(
    (target: PollUpdateTarget): void => {
      const match = findPollMessage(loadedMessages(), target);
      if (!match) return;
      void fetchPollResults(match.chatId, match.id)
        .then((result) => {
          applyPoll({ chatId: match.chatId, messageId: match.id, pollId: result.poll.id }, result.poll);
        })
        .catch(() => {
          // Nothing to surface: an out-of-date count settles on the next load.
        });
    },
    [loadedMessages, applyPoll],
  );
}
