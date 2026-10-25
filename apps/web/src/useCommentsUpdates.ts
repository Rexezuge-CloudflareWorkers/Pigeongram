import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { readHistory } from './api';
import { applyCommentEdit, applyCommentMessage, applyCommentReactions, isThreadComment, updateCommentsThread } from './state';
import type { CommentsThread } from './state';
import type { UpdateEvent } from './types';
import type { CommentsPolling } from './useCommentsPoll';

/**
The comments screen's live half: it folds the updates socket into the open
thread. The controller composes it and keeps the loaded window and cursor; a
live fold never rewinds a page the view already holds.
*/

export function useCommentsUpdates(
  threadRef: RefObject<CommentsThread | null>,
  setThread: Dispatch<SetStateAction<CommentsThread | null>>,
  polling: Pick<CommentsPolling, 'applyPoll' | 'refreshPoll'>,
): (update: UpdateEvent) => void {
  const { applyPoll, refreshPoll } = polling;

  return useCallback(
    (update: UpdateEvent): void => {
      if (update.type === 'new_message') {
        const open = threadRef.current;
        if (open && isThreadComment(open, update.message)) {
          void readHistory(update.message.chatId).catch(() => {
            // Read receipts are best-effort; the next open retries.
          });
        }
        setThread((current) => applyCommentMessage(current, update.message));
        return;
      }
      if (update.type === 'edit_message') {
        setThread((current) => applyCommentEdit(current, update.message));
        return;
      }
      if (update.type === 'reactions') {
        setThread((current) => applyCommentReactions(current, update.chatId, update.messageId, update.reactions));
        return;
      }
      if (update.type === 'views') {
        // The pinned post header is the screen's only message with views; the
        // guard drops a view update that belongs to another post.
        setThread((current) =>
          updateCommentsThread(current, { chatId: update.chatId, messageId: update.messageId }, (open) => ({
            ...open,
            post: { ...open.post, views: update.views },
          })),
        );
        return;
      }
      if (update.type === 'poll') {
        if (update.poll === null) refreshPoll(update);
        else applyPoll(update, update.poll);
      }
    },
    [applyPoll, refreshPoll, setThread, threadRef],
  );
}
