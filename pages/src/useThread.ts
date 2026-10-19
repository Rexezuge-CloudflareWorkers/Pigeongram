import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fetchHistory, fetchPollResults, sendMessage, sendReaction, sendVote, uploadFile } from './api';
import {
  applyCommentCountDelta,
  applyReactionUpdate,
  applyViewsUpdate,
  findPollMessage,
  mergeMessages,
  replaceMessage,
  toggleReaction,
  updateThread,
  updateThreadPoll,
} from './state';
import type { ChatThread, PollUpdateTarget } from './state';
import { fetchOpenWindow } from './thread-window';
import type { OpenThreadOptions } from './thread-window';
import type { ChatDto, MessageDto, MessagePollDto, MessageReactionDto, PeerId, UpdateEvent } from './types';
import { prepareUpload } from './upload';

/**
The chat thread's controller: the open chat with its loaded window, the read
watermark the view reports scroll positions against, and the send/attach/react
actions and folding of live updates. A hook rather than state inside `App` so
both stay readable (and under the god-file cap), mirroring `useComments`.
*/

export interface ThreadController {
  /**
  The open chat and its loaded messages, or null while no chat is open.
  */
  thread: ChatThread | null;
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  uploading: boolean;
  uploadProgress: number | null;
  /**
  The last failure of an open, page, send or upload, as shown by the thread.
  */
  error: string | null;
  /**
  Message ids with a reaction request in flight; their chips are disabled.
  */
  reactingIds: ReadonlySet<number>;
  /**
  Message ids with a vote in flight; their poll's answers are disabled.
  */
  votingIds: ReadonlySet<number>;
  /**
  Opens a chat at the dialog's read watermark, reading the first window (or a
  window around a linked post, when one is given). The watermark comes from
  the dialog list, which belongs to the caller. Answers with the window it
  read, so a caller chasing that post (its comments) need not look it up.
  */
  open: (chat: ChatDto, readInboxMaxId: number, options?: OpenThreadOptions) => Promise<MessageDto[]>;
  close: () => void;
  loadOlder: () => Promise<void>;
  send: (text: string, replyTo?: number) => Promise<void>;
  attach: (file: File, caption: string, replyTo?: number) => Promise<void>;
  react: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  Casts a vote in a poll message: the indexes name the selected answers, or
  `null` retracts the current vote.
  */
  vote: (message: MessageDto, options: number[] | null) => void;
  /**
  Advances the open thread's read watermark, for a read the view reported or
  the server confirmed.
  */
  setReadWatermark: (chatId: PeerId, maxId: number) => void;
  /**
  Bumps a loaded channel post's comment count after one of the account's own
  comments was accepted by the comments screen.
  */
  bumpCommentCount: (chatId: PeerId, postId: number) => void;
  /**
  Folds one socket update into the open thread. `App`'s update handler
  forwards every event; updates that are not the thread pass through.
  */
  applyUpdate: (update: UpdateEvent) => void;
}

interface UseThreadOptions {
  /**
  A message the caller sent was accepted: fold it into the dialogs, which
  belong to the caller.
  */
  onSent: (message: MessageDto) => void;
  /**
  Reports a background failure (a reaction that had to roll back) to the
  global toast.
  */
  onError: (error: unknown) => void;
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function useThread({ onSent, onError }: UseThreadOptions): ThreadController {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(new Set());
  const [votingIds, setVotingIds] = useState<ReadonlySet<number>>(new Set());

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest thread: a poll update names a loaded message, and a
  // stale thread would miss it.
  const threadRef = useRef<ChatThread | null>(null);
  useLayoutEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const open = useCallback(async (chat: ChatDto, readInboxMaxId: number, options?: OpenThreadOptions): Promise<MessageDto[]> => {
    const postId = options?.postId ?? null;
    setThread({ chat, messages: [], readInboxMaxId, focusMessageId: postId });
    setError(null);
    setLoading(true);
    try {
      const page = await fetchOpenWindow(chat.id, postId);
      setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, page)));
      return page;
    } catch (failure) {
      setError(failureText(failure));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback((): void => {
    setThread(null);
    setError(null);
  }, []);

  const loadOlder = useCallback(async (): Promise<void> => {
    const chat = thread?.chat;
    const oldest = thread?.messages[0];
    if (!chat || !oldest) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const result = await fetchHistory(chat.id, { limit: 50, offsetId: oldest.id, offsetDate: oldest.date });
      setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, result.messages)));
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setLoadingOlder(false);
    }
  }, [thread]);

  const setReadWatermark = useCallback((chatId: PeerId, maxId: number): void => {
    setThread((current) =>
      current && current.chat.id === chatId ? { ...current, readInboxMaxId: Math.max(current.readInboxMaxId, maxId) } : current,
    );
  }, []);

  const bumpCommentCount = useCallback((chatId: PeerId, postId: number): void => {
    setThread((current) => updateThread(current, chatId, (messages) => applyCommentCountDelta(messages, postId)));
  }, []);

  const send = useCallback(
    async (text: string, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return;
      setSending(true);
      setError(null);
      try {
        const result = await sendMessage(chat.id, text, replyTo);
        setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, [result.message])));
        onSent(result.message);
      } catch (failure) {
        setError(failureText(failure));
        throw failure;
      } finally {
        setSending(false);
      }
    },
    [thread, onSent],
  );

  const attach = useCallback(
    async (file: File, caption: string, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return;
      setUploading(true);
      setUploadProgress(null);
      setError(null);
      try {
        const prepared = await prepareUpload(file);
        const result = await uploadFile(
          {
            chatId: chat.id,
            kind: prepared.kind,
            fileName: prepared.fileName,
            mime: prepared.mime,
            size: prepared.body.size,
            ...(caption.length > 0 && { caption }),
            ...(replyTo !== undefined && { replyTo }),
            ...(prepared.width !== undefined && { width: prepared.width }),
            ...(prepared.height !== undefined && { height: prepared.height }),
            ...(prepared.duration !== undefined && { duration: prepared.duration }),
          },
          prepared.body,
          setUploadProgress,
        );
        setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, [result.message])));
        onSent(result.message);
      } catch (failure) {
        setError(failureText(failure));
        throw failure;
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [thread, onSent],
  );

  const react = useCallback(
    (message: MessageDto, reaction: MessageReactionDto): void => {
      if (reactingIds.has(message.id)) return;
      if (!reaction.chosen && reaction.emoji === null && reaction.customEmojiId === null) return;
      const before = message.reactions;
      const after = toggleReaction(before, reaction);
      const apply = (list: MessageReactionDto[]): void => {
        setThread((current) =>
          updateThread(current, message.chatId, (messages) => applyReactionUpdate(messages, message.chatId, message.id, list)),
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
    [reactingIds, onError],
  );

  /**
  Folds a fresh poll into the open thread, wherever the update points: the
  target's ids name the message when Telegram sent them, and the poll id
  catches the short updates that name neither.
  */
  const applyPoll = useCallback((target: PollUpdateTarget, poll: MessagePollDto): void => {
    setThread((current) => updateThreadPoll(current, target, poll));
  }, []);

  /**
  A short poll update only asks for a recheck: reload the poll of the loaded
  message it points at, if any, and fold that in. Failures stay silent — an
  out-of-date count settles on the next load or vote, and a toast for it would
  interrupt for nothing.
  */
  const refreshPoll = useCallback(
    (target: PollUpdateTarget): void => {
      const open = threadRef.current;
      if (!open) return;
      const match = findPollMessage(open.messages, target);
      if (!match) return;
      void fetchPollResults(match.chatId, match.id)
        .then((result) => {
          applyPoll({ chatId: match.chatId, messageId: match.id, pollId: result.poll.id }, result.poll);
        })
        .catch(() => {
          // Nothing to surface.
        });
    },
    [applyPoll],
  );

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

  const applyUpdate = useCallback((update: UpdateEvent): void => {
    if (update.type === 'new_message') {
      setThread((current) => updateThread(current, update.message.chatId, (messages) => mergeMessages(messages, [update.message])));
      return;
    }
    if (update.type === 'edit_message') {
      setThread((current) => updateThread(current, update.message.chatId, (messages) => replaceMessage(messages, update.message)));
      return;
    }
    if (update.type === 'reactions') {
      setThread((current) =>
        updateThread(current, update.chatId, (messages) =>
          applyReactionUpdate(messages, update.chatId, update.messageId, update.reactions),
        ),
      );
      return;
    }
    if (update.type === 'views') {
      setThread((current) =>
        updateThread(current, update.chatId, (messages) => applyViewsUpdate(messages, update.chatId, update.messageId, update.views)),
      );
      return;
    }
    if (update.type === 'poll') {
      if (update.poll === null) refreshPoll(update);
      else applyPoll(update, update.poll);
      return;
    }
    if (update.type === 'read' && update.inbox) {
      // The peer reading the account's own messages says nothing about the
      // account's unread incoming ones, so only inbox reads move the
      // watermark.
      setThread((current) =>
        current && current.chat.id === update.chatId
          ? { ...current, readInboxMaxId: Math.max(current.readInboxMaxId, update.maxId) }
          : current,
      );
    }
  }, []);

  return {
    thread,
    loading,
    loadingOlder,
    sending,
    uploading,
    uploadProgress,
    error,
    reactingIds,
    votingIds,
    open,
    close,
    loadOlder,
    send,
    attach,
    react,
    vote,
    setReadWatermark,
    bumpCommentCount,
    applyUpdate,
  };
}
