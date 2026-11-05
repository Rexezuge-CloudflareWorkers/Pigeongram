import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchPollResults, sendMessage, sendReaction } from './api';
import { activeReplyKeyboard, foldKeyboardSeed } from './reply-keyboard';
import {
  applyCommentCountDelta,
  applyReactionUpdate,
  applyThreadReadUpdate,
  applyViewsUpdate,
  findPollMessage,
  toggleReaction,
  updateThread,
  updateThreadPoll,
} from './state';
import type { PollUpdateTarget } from './state';
import type { OpenThreadResult, ThreadController } from './thread-controller';
import { useThreadPositionMemory } from './thread-position';
import { applyThreadEdit, applyThreadNewMessage, applyThreadSentMessages } from './thread-state';
import type { ChatThread } from './thread-state';
import type { OpenThreadOptions } from './thread-window';
import type {
  ChatDto,
  DialogDto,
  MessageDto,
  MessagePollDto,
  MessageReactionDto,
  MessageReplyKeyboardButtonDto,
  PeerId,
  UpdateEvent,
} from './types';
import { sendUploadBatch } from './upload';
import type { UploadRequest } from './upload';
import { useMessageButtons } from './useMessageButtons';
import { useOutbox } from './useOutbox';
import { usePollVoting } from './usePollVoting';
import { useThreadOpen } from './useThreadOpen';
import { useThreadPaging } from './useThreadPaging';

/**
The chat thread's controller: the open chat with its loaded window, the read
watermark the view reports scroll positions against, and the send/attach/react
actions and folding of live updates. A hook rather than state inside `App` so
both stay readable (and under the god-file cap), mirroring `useComments`.
*/

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
  /**
  Shows an informational message (a bot's callback answer, a clipboard
  confirmation) in the global notice toast.
  */
  onNotice: (text: string) => void;
}

export function useThread({ onSent, onError, onNotice }: UseThreadOptions): ThreadController {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [keyboardSeed, setKeyboardSeed] = useState<MessageDto | null>(null);
  const [dismissedKeyboardId, setDismissedKeyboardId] = useState<number | null>(null);
  const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(new Set());
  const positions = useThreadPositionMemory();
  const outbox = useOutbox({ onError });
  const {
    open,
    reset: resetOpen,
    loading,
    error,
    setError,
    botCommands,
    description,
  } = useThreadOpen({ thread, setThread, positions, setKeyboardSeed });

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest thread: a poll update names a loaded message, and a
  // stale thread would miss it.
  const threadRef = useRef<ChatThread | null>(null);
  useLayoutEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  // The chat shows the newest reply markup a message carried — even one the
  // loaded range cannot show yet, which is what the seed stands in for — and a
  // dismissed one-time keyboard stays hidden until a newer message replaces it.
  const replyKeyboard = useMemo(() => {
    const active = activeReplyKeyboard(thread?.messages ?? [], keyboardSeed);
    return active !== null && active.messageId === dismissedKeyboardId ? null : active;
  }, [thread?.messages, keyboardSeed, dismissedKeyboardId]);

  const { loadingOlder, loadingNewer, loadOlder, loadNewer, jumpToLatest } = useThreadPaging({ threadRef, setThread, setError });

  const close = useCallback((): void => {
    resetOpen();
    positions.forget();
    setKeyboardSeed(null);
    setDismissedKeyboardId(null);
    setThread(null);
  }, [positions, resetOpen]);

  /**
  Opens a chat, forgetting which one-time keyboard the previous visit dismissed:
  the same keyboard shows again on a fresh open, as it does in the official
  clients.
  */
  const openThread = useCallback(
    (dialog: DialogDto, options?: OpenThreadOptions): Promise<OpenThreadResult> => {
      setDismissedKeyboardId(null);
      return open(dialog, options);
    },
    [open],
  );

  const updateChat = useCallback((chat: ChatDto): void => {
    setThread((current) => (current && current.chat.id === chat.id ? { ...current, chat } : current));
  }, []);

  const setReadWatermark = useCallback((chatId: PeerId, maxId: number): void => {
    setThread((current) =>
      current && current.chat.id === chatId ? { ...current, readInboxMaxId: Math.max(current.readInboxMaxId, maxId) } : current,
    );
  }, []);

  const bumpCommentCount = useCallback((chatId: PeerId, postId: number): void => {
    setThread((current) => updateThread(current, chatId, (messages) => applyCommentCountDelta(messages, postId)));
  }, []);

  const send = useCallback(
    (text: string, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return Promise.resolve();
      const replyPreview = replyTo === undefined ? null : (thread.messages.find((message) => message.id === replyTo) ?? null);
      outbox.send({
        chatId: chat.id,
        scope: String(chat.id),
        text,
        ...(replyTo !== undefined && { replyTo }),
        replyPreview,
        deliver: (body, randomIds) => {
          if (body.kind !== 'text') throw new Error('The outbox delivered a file body for a text message');
          return sendMessage(chat.id, body.text, body.replyTo, randomIds[0]).then((result) => [result.message]);
        },
        onSettled: (messages) => {
          setThread((current) => applyThreadSentMessages(current, chat.id, messages));
          const last = messages.at(-1);
          if (last) onSent(last);
        },
      });
      return Promise.resolve();
    },
    [thread, outbox, onSent],
  );

  const attach = useCallback(
    (request: UploadRequest): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return Promise.resolve();
      const replyPreview =
        request.replyTo === undefined ? null : (thread.messages.find((message) => message.id === request.replyTo) ?? null);
      outbox.attach({
        chatId: chat.id,
        scope: String(chat.id),
        request,
        replyPreview,
        deliver: (body, randomIds, onProgress) => {
          if (body.kind !== 'file') throw new Error('The outbox delivered a text body for an attachment');
          const messages: MessageDto[] = [];
          return sendUploadBatch(
            { chatId: chat.id, ...(request.replyTo !== undefined && { replyTo: request.replyTo }) },
            body.request,
            (fraction) => onProgress(fraction ?? 0),
            (message) => {
              messages.push(message);
            },
            randomIds,
          ).then(() => messages);
        },
        onSettled: (messages) => {
          setThread((current) => applyThreadSentMessages(current, chat.id, messages));
          const last = messages.at(-1);
          if (last) onSent(last);
        },
      });
      return Promise.resolve();
    },
    [thread, outbox, onSent],
  );

  /**
  Presses a reply keyboard button: a text button sends its text, exactly as
  typing and sending it would, and a one-time keyboard hides once pressed.
  The remaining kinds are handled by the view (web views) or shown disabled.
  */
  const pressReplyKeyboardButton = useCallback(
    (button: MessageReplyKeyboardButtonDto, replyTo?: number): void => {
      if (replyKeyboard === null || button.kind !== 'text') return;
      if (replyKeyboard.keyboard.oneTime) setDismissedKeyboardId(replyKeyboard.messageId);
      void send(button.text, replyTo);
    },
    [replyKeyboard, send],
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

  const { votingIds, vote } = usePollVoting(applyPoll, onError);
  const { pressingIds: pressingButtonIds, press: pressButton } = useMessageButtons(onNotice, onError);

  const applyUpdate = useCallback((update: UpdateEvent): void => {
    if (update.type === 'new_message') {
      // The reply keyboard belongs to the chat, not to the window: a message
      // that carries a markup decides it even when the loaded range is behind
      // a backlog and the message itself waits for paging.
      setKeyboardSeed((current) => foldKeyboardSeed(current, update.message));
      setThread((current) => applyThreadNewMessage(current, update.message));
      return;
    }
    if (update.type === 'edit_message') {
      setKeyboardSeed((current) => foldKeyboardSeed(current, update.message, true));
      setThread((current) => applyThreadEdit(current, update.message));
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
    if (update.type === 'read') setThread((current) => applyThreadReadUpdate(current, update));
  }, []);

  return {
    thread,
    loading,
    loadingOlder,
    loadingNewer,
    pending: outbox.pending,
    error,
    botCommands,
    description,
    replyKeyboard,
    reactingIds,
    votingIds,
    pressingButtonIds,
    open: openThread,
    close,
    updateChat,
    loadOlder,
    loadNewer,
    jumpToLatest,
    send,
    attach,
    retryPending: outbox.retry,
    discardPending: outbox.discard,
    clearPending: outbox.clear,
    react,
    vote,
    pressButton,
    pressReplyKeyboardButton,
    setReadWatermark,
    bumpCommentCount,
    positions,
    applyUpdate,
  };
}
