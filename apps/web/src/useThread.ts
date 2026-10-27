import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fetchChatScreen, fetchPollResults, sendMessage, sendReaction } from './api';
import { firstUnread } from './reading';
import {
  applyCommentCountDelta,
  applyReactionUpdate,
  applyThreadReadUpdate,
  applyViewsUpdate,
  findPollMessage,
  mergeMessages,
  toggleReaction,
  updateThread,
  updateThreadPoll,
} from './state';
import type { PollUpdateTarget } from './state';
import type { ThreadController, OpenThreadResult } from './thread-controller';
import { useThreadPositionMemory } from './thread-position';
import { applyThreadEdit, applyThreadNewMessage, applyThreadSentMessages } from './thread-state';
import type { ChatThread } from './thread-state';
import { supportsCommands, unreadWindow, WINDOW_LIMIT } from './thread-window';
import type { OpenThreadOptions } from './thread-window';
import type { BotCommandDto, DialogDto, MessageDto, MessagePollDto, MessageReactionDto, PeerId, UpdateEvent } from './types';
import { sendUploadBatch } from './upload';
import type { UploadRequest } from './upload';
import { useMessageButtons } from './useMessageButtons';
import { useOutbox } from './useOutbox';
import { usePollVoting } from './usePollVoting';
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
  const [error, setError] = useState<string | null>(null);
  const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(new Set());
  const [botCommands, setBotCommands] = useState<readonly BotCommandDto[]>(NO_COMMANDS);
  const positions = useThreadPositionMemory();
  const outbox = useOutbox({ onError });

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest thread: a poll update names a loaded message, and a
  // stale thread would miss it.
  const threadRef = useRef<ChatThread | null>(null);
  useLayoutEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const { loadingOlder, loadingNewer, loadOlder, loadNewer, jumpToLatest } = useThreadPaging({ threadRef, setThread, setError });

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
        windowEndId: null,
        latestMessageId: dialog.lastMessage?.id ?? null,
      });
      setError(null);
      setLoading(true);
      try {
        // A chat with unread messages opens at where reading stopped, not at
        // the newest page: the watermark anchors a window that reaches a little
        // way back for context and the rest of the page towards the unread
        // side. A large backlog can still extend past that page; forward paging
        // continues from the window's end.
        const unread = postId === null && dialog.unread > 0 ? unreadWindow(dialog.readInboxMaxId) : null;
        // The window, the chat's slash commands and — when a post is named —
        // its comments are one request: the engine reads them at the same
        // time, where separate requests would queue behind each other.
        const screen = await fetchChatScreen(chat.id, postId, {
          limit: WINDOW_LIMIT,
          ...(postId !== null && { anchorId: postId }),
          ...(unread !== null && unread),
          withCommands: supportsCommands(chat.kind),
        });
        setBotCommands(screen.commands);
        const screenEnd = screen.messages.at(-1)?.id ?? null;
        // A live message can arrive while the window is in flight. If the
        // window was at the newest message when it was requested, those
        // messages continue it and are kept; otherwise they sit beyond the
        // backlog and wait for forward paging. An own send is the reader's own
        // action and stays either way, with the gap left for paging to fill;
        // an empty window has no range to be behind, so its messages stay too.
        const openedLatest = dialog.lastMessage?.id ?? null;
        const reachedAtOpen = screenEnd !== null && (openedLatest === null || screenEnd >= openedLatest);
        setThread((current) =>
          current && current.chat.id === chat.id
            ? {
                ...current,
                messages: mergeMessages(
                  screen.messages,
                  current.messages.filter((message) => reachedAtOpen || screenEnd === null || message.outgoing || message.id <= screenEnd),
                ),
                unreadDividerId: divider(screen.messages),
                // A plain read starts at the newest message, so a short window
                // is the whole history. A jump window is anchored mid-history
                // and can be short without being the start, so it always has a
                // page to ask for until one comes back empty.
                hasMoreOlder: postId === null ? screen.messages.length >= WINDOW_LIMIT : screen.messages.length > 0,
                windowEndId: reachedAtOpen ? Math.max(screenEnd ?? 0, current.latestMessageId ?? 0) : screenEnd,
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
      setThread((current) => applyThreadNewMessage(current, update.message));
      return;
    }
    if (update.type === 'edit_message') {
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
    reactingIds,
    votingIds,
    pressingButtonIds,
    open,
    close,
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
    setReadWatermark,
    bumpCommentCount,
    positions,
    applyUpdate,
  };
}
