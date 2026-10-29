import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sendComment, sendReaction } from './api';
import type { PostKey } from './comments-controller';
import type { PendingMessage } from './outbox';
import { applyCommentReactions, mergeMessages, toggleReaction, updateCommentsThread } from './state';
import type { CommentsThread } from './state';
import type { MessageDto, MessageReactionDto, PeerId } from './types';
import { sendUploadBatch } from './upload';
import type { UploadRequest } from './upload';
import { useOutbox } from './useOutbox';

/**
The comments screen's write half: the optimistic outbox behind sends and
attachments, and the reaction toggle. It reads the open thread and never owns
it — the controller beside it keeps the window and the cursor.
*/

interface UseCommentsSendOptions {
  /**
  The open thread, or null while the comments screen is closed.
  */
  thread: CommentsThread | null;
  setThread: Dispatch<SetStateAction<CommentsThread | null>>;
  /**
  Re-reads the thread. The first comment creates the discussion thread, so
  the send response cannot carry the group's coordinates; a re-read settles
  them.
  */
  refresh: (post: PostKey) => Promise<void>;
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
}

export interface CommentsSend {
  /**
  Comments still on their way to Telegram, in submission order. They render
  beside the loaded comments and never enter the thread's message list.
  */
  pending: readonly PendingMessage[];
  /**
  Comment (or pinned post) ids with a reaction request in flight; their chips
  are disabled.
  */
  reactingIds: ReadonlySet<number>;
  send: (text: string, replyTo?: number) => Promise<void>;
  attach: (request: UploadRequest) => Promise<void>;
  react: (message: MessageDto, reaction: MessageReactionDto) => void;
  retryPending: (key: string) => void;
  discardPending: (key: string) => void;
  clearPending: () => void;
}

export function useCommentsSend({ thread, setThread, refresh, onCommentSent, onError }: UseCommentsSendOptions): CommentsSend {
  // The ids with a reaction request in flight; their chips are disabled.
  // Comments and the pinned post share the set, like the vote and button ones.
  const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(new Set());
  const outbox = useOutbox({ onError });

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
    [onCommentSent, setThread],
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
      const before = message.reactions;
      const after = toggleReaction(before, reaction);
      // The reaction may be on a comment or on the pinned post; the fold picks
      // the one the update names (the channel post or the discussion group).
      const apply = (list: MessageReactionDto[]): void => {
        setThread((current) => applyCommentReactions(current, message.chatId, message.id, list));
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
    [thread, reactingIds, setThread, onError],
  );

  return {
    pending: outbox.pending,
    reactingIds,
    send,
    attach,
    react,
    retryPending: outbox.retry,
    discardPending: outbox.discard,
    clearPending: outbox.clear,
  };
}
