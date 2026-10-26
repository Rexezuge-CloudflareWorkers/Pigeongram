import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fetchComments, readHistory } from './api';
import type { CommentsController, PostKey, PrefetchedComments } from './comments-controller';
import { mergeMessages, updateCommentsThread } from './state';
import type { CommentsThread } from './state';
import type { ChatDto, GetCommentsResult, MessageDto, PeerId } from './types';
import { useCommentsPoll } from './useCommentsPoll';
import { useCommentsSend } from './useCommentsSend';
import { useCommentsUpdates } from './useCommentsUpdates';
import { useMessageButtons } from './useMessageButtons';

/**
The comments screen's controller: the open channel-post thread with its loaded
window and cursor, the reads and pages, and the two halves that act on it —
`useCommentsSend` owns the sends and reactions, `useCommentsUpdates` folds the
live updates in. A hook rather than state inside `App` so both stay readable
(and under the god-file cap) and the comments flow can be understood on its
own.
*/

/**
Comments page size; mirrors the thread's history window.
*/
const COMMENTS_LIMIT = 50;

/**
The pagination cursor of a `getComments` result, when older comments remain.
*/
function commentsCursor(result: GetCommentsResult): { id: number; date: number } | null {
  if (result.nextOffsetId === undefined || result.nextOffsetDate === undefined) return null;
  return { id: result.nextOffsetId, date: result.nextOffsetDate };
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

interface UseCommentsOptions {
  /**
  A comment the caller sent was accepted: bump the channel post's count in the
  open channel thread, and fold the comment into the dialogs when it landed in
  the discussion group.
  */
  onCommentSent: (chatId: PeerId, postId: number, comment: MessageDto) => void;
  /**
  Reports a background failure (a reaction that had to roll back) to the
  global toast.
  */
  onError: (error: unknown) => void;
  /**
  Shows an informational message (a bot's callback answer, a clipboard
  confirmation) in the global notice toast.
  */
  onNotice: (text: string) => void;
}

export function useComments({ onCommentSent, onError, onNotice }: UseCommentsOptions): CommentsController {
  const [thread, setThread] = useState<CommentsThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest thread; a layout effect runs with the commit, so no
  // event can observe a thread the state no longer describes.
  const threadRef = useRef<CommentsThread | null>(null);
  useLayoutEffect(() => {
    threadRef.current = thread;
  }, [thread]);
  // A page in flight, tracked outside React state so a scroll event and the
  // button cannot both start one before the disabled state paints.
  const loadingOlderRef = useRef(false);

  const { applyPoll, refreshPoll, votingIds, vote } = useCommentsPoll(threadRef, setThread, onError);
  const { pressingIds: pressingButtonIds, press: pressButton } = useMessageButtons(onNotice, onError);

  /**
  Folds a read of the thread into the open window and reports the read to
  Telegram. An already-loaded older-pages cursor stays put: a refresh can
  only make the window newer, and rewinding it would re-fetch pages the view
  already holds.
  */
  const applyComments = useCallback((post: PostKey, result: GetCommentsResult): void => {
    setThread((current) =>
      updateCommentsThread(current, post, (open) => ({
        ...open,
        comments: mergeMessages(open.comments, result.comments),
        count: result.count,
        discussionChatId: result.discussionChatId,
        discussionMessageId: result.discussionMessageId,
        botCommands: result.commands ?? [],
        nextOffset: open.nextOffset ?? commentsCursor(result),
      })),
    );
    if (result.discussionChatId !== null) {
      // Reading the thread is reading the group; the badge may cover other
      // threads, so the dialog row is left alone and the server pushes a read
      // update when it agrees.
      void readHistory(result.discussionChatId).catch(() => {
        // Read receipts are best-effort; the next open retries.
      });
    }
  }, []);

  const refresh = useCallback(
    async (post: PostKey): Promise<void> => {
      applyComments(post, await fetchComments(post.chatId, post.messageId, { limit: COMMENTS_LIMIT }));
    },
    [applyComments],
  );

  const open = useCallback(
    async (chat: ChatDto, message: MessageDto, prefetched?: PrefetchedComments): Promise<void> => {
      const count = message.comments?.count ?? 0;
      // Reopening the same post keeps the loaded window and its cursor and
      // just re-reads it; another post starts from scratch.
      setThread((current) =>
        current && current.chat.id === chat.id && current.post.id === message.id
          ? { ...current, post: message, count }
          : {
              chat,
              post: message,
              discussionChatId: null,
              discussionMessageId: null,
              botCommands: [],
              comments: [],
              count,
              nextOffset: null,
            },
      );
      setError(null);
      setLoading(true);
      try {
        const post = { chatId: chat.id, messageId: message.id };
        if (prefetched === undefined) {
          await refresh(post);
        } else if (prefetched.ok) {
          applyComments(post, prefetched.result);
        } else {
          setError(prefetched.error);
        }
      } catch (failure) {
        setError(failureText(failure));
      } finally {
        setLoading(false);
      }
    },
    [applyComments, refresh],
  );

  const close = useCallback((): void => {
    setThread(null);
    setError(null);
  }, []);

  const loadOlder = useCallback(async (): Promise<void> => {
    const open = threadRef.current;
    const oldest = open?.nextOffset;
    if (!open || !oldest || loadingOlderRef.current) return;
    const post = { chatId: open.chat.id, messageId: open.post.id };
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setError(null);
    try {
      const result = await fetchComments(post.chatId, post.messageId, {
        limit: COMMENTS_LIMIT,
        offsetId: oldest.id,
        offsetDate: oldest.date,
      });
      setThread((current) =>
        updateCommentsThread(current, post, (open) => ({
          ...open,
          comments: mergeMessages(open.comments, result.comments),
          count: result.count,
          nextOffset: commentsCursor(result),
        })),
      );
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, []);

  const { pending, reactingIds, send, attach, react, retryPending, discardPending, clearPending } = useCommentsSend({
    thread,
    setThread,
    refresh,
    onCommentSent,
    onError,
  });
  const applyUpdate = useCommentsUpdates(threadRef, setThread, { applyPoll, refreshPoll });

  return {
    thread,
    loading,
    loadingOlder,
    pending,
    error,
    reactingIds,
    votingIds,
    pressingButtonIds,
    open,
    close,
    loadOlder,
    send,
    attach,
    retryPending,
    discardPending,
    clearPending,
    react,
    vote,
    pressButton,
    applyUpdate,
  };
}
