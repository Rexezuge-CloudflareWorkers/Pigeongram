import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fetchComments, readHistory, sendComment, sendReaction } from './api';
import type { CommentsController } from './comments-controller';
import {
  applyCommentEdit,
  applyCommentMessage,
  applyCommentReactions,
  applyReactionUpdate,
  isThreadComment,
  mergeMessages,
  toggleReaction,
  updateCommentsThread,
} from './state';
import type { CommentsThread } from './state';
import type { ChatDto, GetCommentsResult, MessageDto, MessageReactionDto, PeerId, UpdateEvent } from './types';
import { sendUploadBatch } from './upload';
import type { UploadRequest } from './upload';
import { useCommentsPoll } from './useCommentsPoll';
import { useMessageButtons } from './useMessageButtons';
import { useOutbox } from './useOutbox';

/**
The comments screen's controller: the open channel-post thread with its loaded
window and cursor, the send/attach/react actions and the folding of live
updates. A hook rather than state inside `App` so both stay readable (and under
the god-file cap) and the comments flow can be understood on its own.
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

/**
A channel post addressed the way the comments bridge does.
*/
type PostKey = { chatId: PeerId; messageId: number };

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
  const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(new Set());
  const outbox = useOutbox({ onError });

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest thread; a layout effect runs with the commit, so no
  // event can observe a thread the state no longer describes.
  const threadRef = useRef<CommentsThread | null>(null);
  useLayoutEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const { applyPoll, refreshPoll, votingIds, vote } = useCommentsPoll(threadRef, setThread, onError);
  const { pressingIds: pressingButtonIds, press: pressButton } = useMessageButtons(onNotice, onError);

  /**
  Re-reads the newest window of the open thread and folds it in. An
  already-loaded older-pages cursor stays put: a refresh can only make the
  window newer, and rewinding it would re-fetch pages the view already holds.
  */
  const refresh = useCallback(async (post: PostKey): Promise<void> => {
    const result = await fetchComments(post.chatId, post.messageId, { limit: COMMENTS_LIMIT });
    setThread((current) =>
      updateCommentsThread(current, post, (open) => ({
        ...open,
        comments: mergeMessages(open.comments, result.comments),
        count: result.count,
        discussionChatId: result.discussionChatId,
        discussionMessageId: result.discussionMessageId,
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

  const open = useCallback(
    async (chat: ChatDto, message: MessageDto): Promise<void> => {
      const count = message.comments?.count ?? 0;
      // Reopening the same post keeps the loaded window and its cursor and
      // just re-reads it; another post starts from scratch.
      setThread((current) =>
        current && current.chat.id === chat.id && current.post.id === message.id
          ? { ...current, post: message, count }
          : { chat, post: message, discussionChatId: null, discussionMessageId: null, comments: [], count, nextOffset: null },
      );
      setError(null);
      setLoading(true);
      try {
        await refresh({ chatId: chat.id, messageId: message.id });
      } catch (failure) {
        setError(failureText(failure));
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  const close = useCallback((): void => {
    setThread(null);
    setError(null);
  }, []);

  const loadOlder = useCallback(async (): Promise<void> => {
    const oldest = thread?.nextOffset;
    if (!thread || !oldest) return;
    const post = { chatId: thread.chat.id, messageId: thread.post.id };
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
      setLoadingOlder(false);
    }
  }, [thread]);

  /**
  Folds a sent comment into the open window and hands it to the caller for the
  channel thread and the dialogs. The merge de-duplicates by id and the count
  only bumps when the comment is genuinely new: the socket may re-deliver it
  after the send response already merged it.
  */
  const applySentComment = useCallback(
    (open: CommentsThread, comment: MessageDto): void => {
      const post = { chatId: open.chat.id, messageId: open.post.id };
      setThread((current) =>
        updateCommentsThread(current, post, (candidate) => {
          if (candidate.comments.some((loaded) => loaded.id === comment.id)) return candidate;
          return { ...candidate, comments: mergeMessages(candidate.comments, [comment]), count: candidate.count + 1 };
        }),
      );
      onCommentSent(open.chat.id, open.post.id, comment);
    },
    [onCommentSent],
  );

  const send = useCallback(
    (text: string, replyTo?: number): Promise<void> => {
      const open = thread;
      if (!open) return Promise.resolve();
      const post = { chatId: open.chat.id, messageId: open.post.id };
      // The first comment creates the discussion thread, so the send response
      // cannot carry the group's coordinates; a re-read settles them.
      const first = open.discussionChatId === null;
      const replyPreview = replyTo === undefined ? null : (open.comments.find((comment) => comment.id === replyTo) ?? null);
      outbox.send({
        chatId: open.discussionChatId ?? open.chat.id,
        scope: `${String(post.chatId)}:${String(post.messageId)}`,
        text,
        ...(replyTo !== undefined && { replyTo }),
        replyPreview,
        deliver: (body, randomIds) => {
          if (body.kind !== 'text') throw new Error('The outbox delivered a file body for a text comment');
          return sendComment(post.chatId, post.messageId, body.text, body.replyTo, randomIds[0]).then((result) => [result.message]);
        },
        onSettled: (messages) => {
          for (const comment of messages) applySentComment(open, comment);
          if (first) {
            void refresh(post).catch(() => {
              // The comment went out; only the thread coordinates stay unknown.
            });
          }
        },
      });
      return Promise.resolve();
    },
    [thread, applySentComment, refresh, outbox],
  );

  const attach = useCallback(
    (request: UploadRequest): Promise<void> => {
      const open = thread;
      if (!open) return Promise.resolve();
      const post = { chatId: open.chat.id, messageId: open.post.id };
      const first = open.discussionChatId === null;
      const replyPreview = request.replyTo === undefined ? null : (open.comments.find((comment) => comment.id === request.replyTo) ?? null);
      outbox.attach({
        chatId: open.discussionChatId ?? open.chat.id,
        scope: `${String(post.chatId)}:${String(post.messageId)}`,
        request,
        replyPreview,
        deliver: (body, randomIds, onProgress) => {
          if (body.kind !== 'file') throw new Error('The outbox delivered a text body for an attachment');
          const comments: MessageDto[] = [];
          return sendUploadBatch(
            {
              chatId: post.chatId,
              commentTo: post.messageId,
              ...(request.replyTo !== undefined && { replyTo: request.replyTo }),
            },
            body.request,
            (fraction) => onProgress(fraction ?? 0),
            (comment) => {
              comments.push(comment);
            },
            randomIds,
          ).then(() => comments);
        },
        onSettled: (messages) => {
          for (const comment of messages) applySentComment(open, comment);
          if (first) {
            void refresh(post).catch(() => {
              // The upload went out; only the thread coordinates stay unknown.
            });
          }
        },
      });
      return Promise.resolve();
    },
    [thread, applySentComment, refresh, outbox],
  );

  const react = useCallback(
    (message: MessageDto, reaction: MessageReactionDto): void => {
      if (!thread || reactingIds.has(message.id)) return;
      if (!reaction.chosen && reaction.emoji === null && reaction.customEmojiId === null) return;
      const post = { chatId: thread.chat.id, messageId: thread.post.id };
      const before = message.reactions;
      const after = toggleReaction(before, reaction);
      const apply = (list: MessageReactionDto[]): void => {
        setThread((current) =>
          updateCommentsThread(current, post, (open) => ({
            ...open,
            comments: applyReactionUpdate(open.comments, message.chatId, message.id, list),
          })),
        );
      };
      apply(after);
      setReactingIds((current) => new Set(current).add(message.id));
      const target = reaction.chosen
        ? null
        : reaction.emoji === null
          ? { customEmojiId: reaction.customEmojiId as string }
          : { emoji: reaction.emoji };
      void sendReaction(message.chatId, message.id, target)
        .then((result) => {
          if (result.message) apply(result.message.reactions);
        })
        .catch((failure: unknown) => {
          apply(before);
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
    [thread, reactingIds, onError],
  );

  const applyUpdate = useCallback(
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
    [applyPoll, refreshPoll],
  );

  return {
    thread,
    loading,
    loadingOlder,
    pending: outbox.pending,
    error,
    reactingIds,
    votingIds,
    pressingButtonIds,
    open,
    close,
    loadOlder,
    send,
    attach,
    retryPending: outbox.retry,
    discardPending: outbox.discard,
    clearPending: outbox.clear,
    react,
    vote,
    pressButton,
    applyUpdate,
  };
}
