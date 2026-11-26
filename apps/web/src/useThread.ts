import { useCallback, useMemo, useState } from 'react';
import { activeReplyKeyboard, foldKeyboardSeed } from './reply-keyboard';
import {
  applyCommentCountDelta,
  applyReactionUpdate,
  applyThreadReadUpdate,
  applyViewsUpdate,
  deletionReport,
  updateThread,
  updateThreadPoll,
} from './state';
import type { PollUpdateTarget } from './state';
import type { OpenThreadResult, ThreadController, UseThreadOptions } from './thread-controller';
import { useThreadPositionMemory } from './thread-position';
import { useLatestLayout } from './useLatest';
import { usePollRefresh } from './usePollRefresh';
import { useReactionToggle } from './useReactionToggle';
import { applyThreadDeleted, applyThreadEdit, applyThreadNewMessage, applyThreadRestored } from './thread-state';
import type { ChatThread } from './thread-state';
import type { OpenThreadOptions } from './thread-window';
import type { ChatDto, DialogDto, MessageDto, MessagePollDto, MessageReplyKeyboardButtonDto, PeerId, UpdateEvent } from './types';
import { useMessageButtons } from './useMessageButtons';
import { useMessageEdit } from './useMessageEdit';
import { useMessageDelete } from './useMessageDelete';
import { useOutbox } from './useOutbox';
import { usePollVoting } from './usePollVoting';
import { useThreadOpen } from './useThreadOpen';
import { useThreadPaging } from './useThreadPaging';
import { useThreadPinned } from './useThreadPinned';
import { useThreadSends } from './useThreadSends';

/**
The chat thread's controller: the open chat with its loaded window, the read
watermark the view reports scroll positions against, and the send/attach/react
actions and folding of live updates. A hook rather than state inside `App` so
both stay readable (and under the god-file cap), mirroring `useComments`.
*/

export function useThread({ onSent, onEdited, onError, onNotice, onDeleted, onUnavailable }: UseThreadOptions): ThreadController {
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
    unavailable,
    botCommands,
    description,
  } = useThreadOpen({ thread, setThread, positions, setKeyboardSeed, onUnavailable });

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest thread: a poll update names a loaded message, and a
  // stale thread would miss it.
  const threadRef = useLatestLayout(thread);

  const edit = useMessageEdit({ setThread, onEdited, onError });

  // The socket handler is created once, so the deletion report is read through
  // a ref: the shell rebuilds its handler together with the dialogs.
  const onDeletedRef = useLatestLayout(onDeleted);

  // The chat shows the newest reply markup a message carried — even one the
  // loaded range cannot show yet, which is what the seed stands in for — and a
  // dismissed one-time keyboard stays hidden until a newer message replaces it.
  const replyKeyboard = useMemo(() => {
    const active = activeReplyKeyboard(thread?.messages ?? [], keyboardSeed);
    return active !== null && active.messageId === dismissedKeyboardId ? null : active;
  }, [thread?.messages, keyboardSeed, dismissedKeyboardId]);

  const { loadingOlder, loadingNewer, loadOlder, loadNewer, jumpToLatest } = useThreadPaging({ threadRef, setThread, setError });
  // The banner and the pinned-list revision follow the pin updates and the
  // write's answer; the hook owns the read that names the banner's body.
  const pinned = useThreadPinned({ setThread, threadRef, onError });

  const close = useCallback((): void => {
    resetOpen();
    positions.forget();
    setKeyboardSeed(null);
    setDismissedKeyboardId(null);
    edit.reset();
    setThread(null);
  }, [edit, positions, resetOpen]);

  /**
  Opens a chat, forgetting which one-time keyboard the previous visit dismissed:
  the same keyboard shows again on a fresh open, as it does in the official
  clients.
  */
  const openThread = useCallback(
    (dialog: DialogDto, options?: OpenThreadOptions): Promise<OpenThreadResult> => {
      setDismissedKeyboardId(null);
      edit.reset();
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

  const { send, attach, sendSticker: sendStickerMessage } = useThreadSends({ thread, outbox, setThread, onSent });

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

  /**
  Removes messages from the open window ahead of Telegram's answer.
  */
  const removeMessages = useCallback((chatId: PeerId, messageIds: readonly number[]): void => {
    setThread((current) => applyThreadDeleted(current, chatId, messageIds));
  }, []);

  /**
  Puts messages a refused delete took out back into the open window.
  */
  const restoreMessages = useCallback((messages: readonly MessageDto[]): void => {
    setThread((current) => applyThreadRestored(current, messages));
  }, []);

  const deletion = useMessageDelete({ remove: removeMessages, restore: restoreMessages, onError });

  const react = useReactionToggle({
    reactingIds,
    setReactingIds,
    apply: (message, list) => {
      setThread((current) =>
        updateThread(current, message.chatId, (messages) => applyReactionUpdate(messages, message.chatId, message.id, list)),
      );
    },
    onError,
  });

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
  const loadedMessages = useCallback((): readonly MessageDto[] => threadRef.current?.messages ?? [], [threadRef]);
  const refreshPoll = usePollRefresh(loadedMessages, applyPoll);

  const { votingIds, vote } = usePollVoting(applyPoll, onError);
  const { pressingIds: pressingButtonIds, press: pressButton } = useMessageButtons(onNotice, onError);

  const applyUpdate = useCallback(
    (update: UpdateEvent): void => {
      if (update.type === 'new_message') {
        // The reply keyboard belongs to the chat, not to the window: a message
        // that carries a markup decides it even when the loaded range is behind
        // a backlog and the message itself waits for paging.
        setKeyboardSeed((current) => foldKeyboardSeed(current, update.message));
        setThread((current) => applyThreadNewMessage(current, update.message));
        return;
      }
      if (update.type === 'edit_message') {
        edit.refresh(update.message);
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
      if (update.type === 'deleted') {
        // The engine echoes an accepted delete, and another device's arrives the
        // same way; the chat list is repaired from what the fold matched.
        const report = deletionReport(threadRef.current, update.chatId, update.messageIds);
        if (report) onDeletedRef.current(report.chatId, report.removed, report.remaining);
        // A deleted edit target has nothing left to save.
        edit.forget(update.chatId, update.messageIds);
        setThread((current) => applyThreadDeleted(current, update.chatId, update.messageIds));
        return;
      }
      if (update.type === 'message_pinned') {
        pinned.fold(update);
        return;
      }
      if (update.type === 'read') setThread((current) => applyThreadReadUpdate(current, update));
    },
    [applyPoll, edit, pinned, refreshPoll],
  );

  return {
    thread,
    loading,
    loadingOlder,
    loadingNewer,
    pending: outbox.pending,
    error,
    unavailable,
    botCommands,
    description,
    replyKeyboard,
    reactingIds,
    votingIds,
    pinnedRevision: pinned.revision,
    pressingButtonIds,
    open: openThread,
    close,
    updateChat,
    loadOlder,
    loadNewer,
    jumpToLatest,
    send,
    editing: edit.editing,
    startEdit: edit.startEdit,
    cancelEdit: edit.cancelEdit,
    saveEdit: edit.saveEdit,
    attach,
    sendSticker: sendStickerMessage,
    retryPending: outbox.retry,
    discardPending: outbox.discard,
    clearPending: outbox.clear,
    react,
    setPinned: pinned.setPinned,
    deletion,
    removeMessages,
    restoreMessages,
    vote,
    pressButton,
    pressReplyKeyboardButton,
    setReadWatermark,
    bumpCommentCount,
    positions,
    applyUpdate,
  };
}
