import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { readHistory } from './api';
import { applyCommentEdit, applyCommentMessage, applyCommentReactions, isThreadComment, updateCommentsThread } from './state';
import type { CommentsThread } from './state';
import type { MessageDto, UpdateEvent } from './types';
import type { CommentsPolling } from './useCommentsPoll';

/**
The comments screen's live half: it folds the updates socket into the open
thread. The controller composes it and keeps the loaded window and cursor; a
live fold never rewinds a page the view already holds.
*/

/**
The folds the live half runs beside its own: the controller's poll handling and
its reply-keyboard seed, which a message decides even when the loaded thread
cannot show it yet.
*/
interface CommentsFolds extends Pick<CommentsPolling, 'applyPoll' | 'refreshPoll'> {
  applyKeyboard: (message: MessageDto, edited?: boolean) => void;
}

export function useCommentsUpdates(
  threadRef: RefObject<CommentsThread | null>,
  setThread: Dispatch<SetStateAction<CommentsThread | null>>,
  folds: CommentsFolds,
): (update: UpdateEvent) => void {
  const { applyPoll, refreshPoll, applyKeyboard } = folds;

  return useCallback(
    (update: UpdateEvent): void => {
      if (update.type === 'new_message') {
        applyKeyboard(update.message);
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
        applyKeyboard(update.message, true);
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
    [applyKeyboard, applyPoll, refreshPoll, setThread, threadRef],
  );
}
