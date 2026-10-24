import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fetchChatScreen, fetchHistory, fetchPollResults, sendMessage, sendReaction } from './api';
import { firstUnread } from './reading';
import {
  applyCommentCountDelta,
  applyReactionUpdate,
  applyThreadReadUpdate,
  applyViewsUpdate,
  findPollMessage,
  mergeMessages,
  replaceMessage,
  toggleReaction,
  updateThread,
  updateThreadPoll,
} from './state';
import type { ChatThread, PollUpdateTarget } from './state';
import type { ThreadController, OpenThreadResult } from './thread-controller';
import { useThreadPositionMemory } from './thread-position';
import { supportsCommands, WINDOW_LIMIT } from './thread-window';
import type { OpenThreadOptions } from './thread-window';
import type { BotCommandDto, DialogDto, MessageDto, MessagePollDto, MessageReactionDto, PeerId, UpdateEvent } from './types';
import { sendUploadBatch } from './upload';
import type { UploadRequest } from './upload';
import { useMessageButtons } from './useMessageButtons';
import { useOutbox } from './useOutbox';
import { usePollVoting } from './usePollVoting';

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

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
The empty slash-command menu, before a chat is opened.
*/
const NO_COMMANDS: readonly BotCommandDto[] = [];

export function useThread({ onSent, onError, onNotice }: UseThreadOptions): ThreadController {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(new Set());
  const [botCommands, setBotCommands] = useState<readonly BotCommandDto[]>(NO_COMMANDS);
  const positions = useThreadPositionMemory();
  const outbox = useOutbox({ onError });
  // A page in flight, tracked outside React state so a scroll event and the
  // button cannot both start one before the disabled state paints.
  const loadingOlderRef = useRef(false);

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest thread: a poll update names a loaded message, and a
  // stale thread would miss it.
  const threadRef = useRef<ChatThread | null>(null);
  useLayoutEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const open = useCallback(
    async (dialog: DialogDto, options?: OpenThreadOptions): Promise<OpenThreadResult> => {
      const chat = dialog.chat;
      const postId = options?.postId ?? null;
      // A fresh read is a new session: only a comments detour keeps the
      // remembered position, because it leaves this thread open.
      positions.forget();
      // The divider is decided once, from the window the chat opens with: it
      // marks where reading stopped on open, so reading past it (or a message
      // arriving later) leaves it where it is.
      const divider = (messages: MessageDto[]): number | null => firstUnread(messages, dialog.readInboxMaxId)?.id ?? null;
      setThread({
        chat,
        messages: [],
        readInboxMaxId: dialog.readInboxMaxId,
        readOutboxMaxId: dialog.readOutboxMaxId,
        unreadDividerId: null,
        focusMessageId: postId,
        hasMoreOlder: true,
      });
      setError(null);
      setLoading(true);
      try {
        // The window, the chat's slash commands and — when a post is named —
        // its comments are one request: the engine reads them at the same
        // time, where separate requests would queue behind each other.
        const screen = await fetchChatScreen(chat.id, postId, {
          limit: WINDOW_LIMIT,
          ...(postId !== null && { anchorId: postId }),
          withCommands: supportsCommands(chat.kind),
        });
        setBotCommands(screen.commands);
        setThread((current) =>
          current && current.chat.id === chat.id
            ? {
                ...current,
                messages: mergeMessages(current.messages, screen.messages),
                unreadDividerId: divider(screen.messages),
                // A plain read starts at the newest message, so a short window
                // is the whole history. A jump window is anchored mid-history
                // and can be short without being the start, so it always has a
                // page to ask for until one comes back empty.
                hasMoreOlder: postId === null ? screen.messages.length >= WINDOW_LIMIT : screen.messages.length > 0,
              }
            : current,
        );
        return { messages: screen.messages, comments: screen.comments, commentsError: screen.commentsError };
      } catch (failure) {
        setError(failureText(failure));
        return { messages: [], comments: null, commentsError: failureText(failure) };
      } finally {
        setLoading(false);
      }
    },
    [positions],
  );

  const close = useCallback((): void => {
    positions.forget();
    setThread(null);
    setError(null);
    setBotCommands(NO_COMMANDS);
  }, [positions]);

  const loadOlder = useCallback(async (): Promise<void> => {
    // The scroll handler and the button both call this; the in-flight ref is
    // what keeps a burst of scroll events to one page.
    const open = threadRef.current;
    const chat = open?.chat;
    const oldest = open?.messages[0];
    if (!open || !chat || !oldest || !open.hasMoreOlder || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setError(null);
    try {
      const result = await fetchHistory(chat.id, { limit: WINDOW_LIMIT, offsetId: oldest.id, offsetDate: oldest.date });
      setThread((current) =>
        current && current.chat.id === chat.id
          ? {
              ...current,
              messages: mergeMessages(current.messages, result.messages),
              // A short page is the oldest one Telegram has.
              hasMoreOlder: result.messages.length >= WINDOW_LIMIT,
            }
          : current,
      );
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
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
          setThread((current) => updateThread(current, chat.id, (list) => mergeMessages(list, messages)));
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
          setThread((current) => updateThread(current, chat.id, (list) => mergeMessages(list, messages)));
          const last = messages.at(-1);
          if (last) onSent(last);
        },
      });
      return Promise.resolve();
    },
    [thread, outbox, onSent],
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
    if (update.type === 'read') setThread((current) => applyThreadReadUpdate(current, update));
  }, []);

  return {
    thread,
    loading,
    loadingOlder,
    pending: outbox.pending,
    error,
    botCommands,
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
    setReadWatermark,
    bumpCommentCount,
    positions,
    applyUpdate,
  };
}
