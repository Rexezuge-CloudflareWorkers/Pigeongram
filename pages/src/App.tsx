import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchDialogs, fetchMe, logout, readHistory } from './api';
import { Avatar } from './components/Avatar';
import { ChatList } from './components/ChatList';
import { CommentsView } from './components/CommentsView';
import { LoginScreen } from './components/LoginScreen';
import { ThreadView } from './components/ThreadView';
import { useLoginFlow, useUpdatesSocket } from './hooks';
import { findLinkedChat, launchTelegramApp, parseTelegramLink } from './links';
import { applyEditedMessage, applyNewMessage, applyReadThrough, applyReadUpdate } from './state';
import { TelegramLinkProvider } from './telegram-links';
import type { ChatDto, DialogDto, MeDto, MessageDto, PeerId, UpdateEvent } from './types';
import { useComments } from './useComments';
import { useThread } from './useThread';

export function App() {
  const { state, gate, error, reportError, onToken, onPhone, onCode, onPassword, onRetry, reset } = useLoginFlow();

  const [me, setMe] = useState<MeDto | null>(null);
  const [dialogs, setDialogs] = useState<DialogDto[]>([]);
  const [dialogsLoading, setDialogsLoading] = useState(false);

  /**
  A message the caller sent (or uploaded) was accepted: fold it into the
  dialogs. The thread's own copy is the controller's.
  */
  const handleSent = useCallback((message: MessageDto): void => {
    setDialogs((current) => applyNewMessage(current, message, message.chatId));
  }, []);

  const threads = useThread({ onSent: handleSent, onError: reportError });
  // Stable helpers, so the callbacks that depend on them keep their identity.
  const applyThreadUpdate = threads.applyUpdate;
  const closeThread = threads.close;
  const setReadWatermark = threads.setReadWatermark;
  const bumpCommentCount = threads.bumpCommentCount;

  /**
  A comment the caller sent was accepted: bump the post's count in the open
  channel thread, and fold the comment into the dialogs when it landed in the
  discussion group. The channel is the right target only for the first comment
  (Telegram mirrors it into the group but the send response may describe it in
  the channel), so that case is left to the dialogs' own update.
  */
  const handleCommentSent = useCallback(
    (chatId: PeerId, postId: number, comment: MessageDto): void => {
      bumpCommentCount(chatId, postId);
      if (comment.chatId !== chatId) {
        setDialogs((current) => applyNewMessage(current, comment, null));
      }
    },
    [bumpCommentCount],
  );

  const comments = useComments({ onCommentSent: handleCommentSent, onError: reportError });
  const closeComments = comments.close;
  const applyCommentUpdate = comments.applyUpdate;

  const selectedRef = useRef<PeerId | null>(null);
  const selected = threads.thread?.chat ?? null;
  const authorized = state?.authorized ?? false;

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest selection. A layout effect runs with the commit, so
  // no socket event can observe the previous chat after a switch.
  useLayoutEffect(() => {
    selectedRef.current = selected?.id ?? null;
  }, [selected]);

  // ---- signed-in data: dialogs, live updates, thread ----------------------

  const loadDialogs = useCallback(async (): Promise<void> => {
    setDialogsLoading(true);
    try {
      const result = await fetchDialogs();
      setDialogs(result.dialogs);
    } catch (failure) {
      reportError(failure);
    } finally {
      setDialogsLoading(false);
    }
  }, [reportError]);

  const booted = useRef(false);
  useEffect(() => {
    if (!authorized) {
      booted.current = false;
      return;
    }
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      if (state?.me) setMe(state.me);
      try {
        setMe((await fetchMe()).me);
      } catch (failure) {
        reportError(failure);
      }
      await loadDialogs();
    })();
  }, [authorized, state?.me, reportError, loadDialogs]);

  const handleUpdate = useCallback(
    (update: UpdateEvent): void => {
      // The comments screen and the open thread listen to the same stream:
      // each folds in what belongs to it and lets everything else pass.
      applyCommentUpdate(update);
      applyThreadUpdate(update);
      if (update.type === 'new_message') {
        setDialogs((current) => applyNewMessage(current, update.message, selectedRef.current));
        // Reading is driven by the view's scroll position: a message pinned to
        // the bottom of the open thread is reported read from there, and one
        // arriving while the user is scrolled up stays unread.
        return;
      }
      if (update.type === 'edit_message') {
        setDialogs((current) => applyEditedMessage(current, update.message));
        return;
      }
      // The peer reading the account's own messages says nothing about the
      // account's unread incoming ones, so only inbox reads move the badge.
      // The thread's watermark is folded by the controller above.
      if (update.type === 'read' && update.inbox) {
        setDialogs((current) => applyReadUpdate(current, update.chatId, update.unread, update.maxId));
      }
    },
    [applyCommentUpdate, applyThreadUpdate],
  );

  const connected = useUpdatesSocket(authorized, handleUpdate, () => {
    void loadDialogs();
  });

  const openChat = useCallback(
    async (chat: ChatDto, target?: { postId?: number; commentId?: number }): Promise<void> => {
      // The dialog's watermark is where reading stopped: the thread opens
      // there instead of the bottom and reports its own progress from then on.
      const boundary = dialogs.find((dialog) => dialog.chat.id === chat.id)?.readInboxMaxId ?? 0;
      closeComments();
      const loaded = await threads.open(chat, boundary, target);
      // A link into a post's comments only lands when the post itself came
      // with the jump window; otherwise the thread simply opens.
      const commentPost =
        target?.postId === undefined || target.commentId === undefined ? undefined : loaded.find((message) => message.id === target.postId);
      if (commentPost) void comments.open(chat, commentPost);
    },
    [closeComments, comments.open, dialogs, threads.open],
  );

  /**
  Routes a click on a link inside a message: a chat this client already knows
  opens in the thread (a linked post lands on that post), any other Telegram
  link is handed to the installed app, and `false` leaves ordinary web links to
  the browser.
  */
  const handleTelegramLink = useCallback(
    (url: string): boolean => {
      const link = parseTelegramLink(url);
      if (link === null) return false;
      const chat = link.chat === null ? null : findLinkedChat(dialogs, link.chat);
      if (chat !== null) {
        void openChat(chat, {
          ...(link.postId !== null && { postId: link.postId }),
          ...(link.commentId !== null && { commentId: link.commentId }),
        });
        return true;
      }
      launchTelegramApp(link.deepLink, link.webUrl);
      return true;
    },
    [dialogs, openChat],
  );

  /**
  Persists what the user read, as reported by the thread's scroll position:
  the dialog's badge and watermark move immediately, the receipt is
  best-effort, and the server's own `read` update settles the exact count.
  */
  const markRead = useCallback(
    (chatId: PeerId, maxId: number): void => {
      const open = threads.thread && threads.thread.chat.id === chatId ? threads.thread : null;
      const boundary = open?.readInboxMaxId ?? dialogs.find((dialog) => dialog.chat.id === chatId)?.readInboxMaxId ?? 0;
      if (maxId <= boundary) return;
      setReadWatermark(chatId, maxId);
      setDialogs((current) => applyReadThrough(current, chatId, maxId, open?.messages ?? []));
      void readHistory(chatId, maxId).catch(() => {
        // Read receipts are best-effort; the next open retries.
      });
    },
    [dialogs, setReadWatermark, threads.thread],
  );

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await logout();
    } catch (failure) {
      reportError(failure);
    }
    closeThread();
    closeComments();
    setDialogs([]);
    setMe(null);
    reset();
  }, [closeComments, closeThread, reportError, reset]);

  if (gate || !authorized) {
    return (
      <LoginScreen
        state={state}
        gate={gate}
        error={error}
        onToken={onToken}
        onPhone={onPhone}
        onCode={onCode}
        onPassword={onPassword}
        onRetry={onRetry}
      />
    );
  }

  const displayName = me ? `${me.firstName}${me.lastName ? ` ${me.lastName}` : ''}` : 'Telegram';
  return (
    <div className={`app${selected ? ' thread-open' : ''}`}>
      <aside className="sidebar">
        <header className="me">
          <Avatar chatId={me?.id ?? 0} photo={me?.photo ?? null} title={displayName} small />
          <div className="me-id">
            <strong>{displayName}</strong>
            <span className="muted small">{connected ? 'live' : 'polling'}</span>
          </div>
          <button type="button" className="ghost" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </header>
        <ChatList dialogs={dialogs} activeChatId={selected?.id ?? null} loading={dialogsLoading} onSelect={(chat) => void openChat(chat)} />
      </aside>
      <TelegramLinkProvider handler={handleTelegramLink}>
        {comments.thread ? (
          <CommentsView
            thread={comments.thread}
            loading={comments.loading}
            loadingOlder={comments.loadingOlder}
            sending={comments.sending}
            uploading={comments.uploading}
            uploadProgress={comments.uploadProgress}
            error={comments.error}
            reactingIds={comments.reactingIds}
            onBack={comments.close}
            onLoadOlder={() => void comments.loadOlder()}
            onSend={comments.send}
            onAttach={comments.attach}
            onReact={comments.react}
          />
        ) : (
          <ThreadView
            chat={selected}
            messages={threads.thread?.messages ?? []}
            loading={threads.loading}
            loadingOlder={threads.loadingOlder}
            sending={threads.sending}
            uploading={threads.uploading}
            uploadProgress={threads.uploadProgress}
            error={threads.error}
            reactingIds={threads.reactingIds}
            votingIds={threads.votingIds}
            unreadDividerId={threads.thread?.unreadDividerId ?? null}
            focusMessageId={threads.thread?.focusMessageId ?? null}
            onBack={() => {
              closeThread();
              closeComments();
            }}
            onLoadOlder={() => void threads.loadOlder()}
            onSend={threads.send}
            onAttach={threads.attach}
            onReact={threads.react}
            onVote={threads.vote}
            onReadThrough={markRead}
            onOpenComments={(message) => {
              if (selected) void comments.open(selected, message);
            }}
          />
        )}
      </TelegramLinkProvider>
      {error ? (
        <p className="toast" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default App;
