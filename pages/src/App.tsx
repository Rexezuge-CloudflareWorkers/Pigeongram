import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchDialogs, fetchMe, logout, readHistory } from './api';
import { ChatList } from './components/ChatList';
import { CheckingAccess } from './components/CheckingAccess';
import { CommentsView } from './components/CommentsView';
import { ForwardPicker } from './components/ForwardPicker';
import { LandingPage } from './components/LandingPage';
import { LoginScreen } from './components/LoginScreen';
import { MediaViewer } from './components/MediaViewer';
import { ThreadView } from './components/ThreadView';
import { UserMenu } from './components/UserMenu';
import { useLoginFlow, useUpdatesSocket } from './hooks';
import { findLinkedChat, launchTelegramApp, parseTelegramLink } from './links';
import type { Route } from './routes';
import { applyEditedMessage, applyNewMessage, applyOutboxReadUpdate, applyReadThrough, applyReadUpdate } from './state';
import { TelegramLinkProvider } from './telegram-links';
import type { ChatDto, DialogDto, MeDto, MessageDto, PeerId, UpdateEvent } from './types';
import { useChatNavigation } from './useChatNavigation';
import { useComments } from './useComments';
import { useForwarding } from './useForwarding';
import { useForwardOrigin } from './useForwardOrigin';
import { useMediaViewer } from './useMediaViewer';
import { useRouter } from './useRouter';
import { useThread } from './useThread';

export function App() {
  const { state, access, error, reportError, retryAccess, onPhone, onCode, onPassword, onRetry, reset } = useLoginFlow();

  const [me, setMe] = useState<MeDto | null>(null);
  const [dialogs, setDialogs] = useState<DialogDto[]>([]);
  const [dialogsLoading, setDialogsLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
  Shows a short informational toast (a bot's callback answer, a clipboard
  confirmation) and refreshes its dismissal timer.
  */
  const notify = useCallback((text: string): void => {
    setNotice(text);
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 4000);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    },
    [],
  );

  /**
  A message the caller sent (or uploaded) was accepted: fold it into the
  dialogs. The thread's own copy is the controller's.
  */
  const handleSent = useCallback((message: MessageDto): void => {
    setDialogs((current) => applyNewMessage(current, message, message.chatId));
  }, []);

  const threads = useThread({ onSent: handleSent, onError: reportError, onNotice: notify });
  const forwarding = useForwarding(handleSent, threads.applyUpdate, notify);
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

  const comments = useComments({ onCommentSent: handleCommentSent, onError: reportError, onNotice: notify });
  const closeComments = comments.close;
  const applyCommentUpdate = comments.applyUpdate;

  const selectedRef = useRef<PeerId | null>(null);
  const selected = threads.thread?.chat ?? null;
  const authorized = state?.authorized ?? false;

  // `canOpen` and the boot apply run outside render (history events and the
  // signed-in boot), so they read the newest dialogs through this ref.
  const dialogsRef = useRef<readonly DialogDto[]>([]);
  useLayoutEffect(() => {
    dialogsRef.current = dialogs;
  }, [dialogs]);

  const viewer = useMediaViewer({ thread: threads.thread, comments: comments.thread });
  const applyRoute = useChatNavigation({ dialogs: dialogsRef, threads, comments });
  const canOpen = useCallback(
    (route: Route): boolean => route.view === 'list' || dialogsRef.current.some((dialog) => dialog.chat.id === route.chatId),
    [],
  );
  const router = useRouter({
    onRoute: applyRoute,
    canOpen,
    onViewerEnter: viewer.reopen,
    onViewerLeave: viewer.close,
  });

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
      // Set the ref first: boot applies the URL route immediately after this
      // returns, before React has committed the new dialogs.
      dialogsRef.current = result.dialogs;
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
      router.boot();
    })();
  }, [authorized, state?.me, reportError, loadDialogs, router.boot]);

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
      // The two read directions mean different things: inbox reads move the
      // badge and open position; outbox reads move the double checks on the
      // account's own messages. The thread folds both in the controller above.
      if (update.type === 'read') {
        setDialogs((current) =>
          update.inbox
            ? applyReadUpdate(current, update.chatId, update.unread, update.maxId)
            : applyOutboxReadUpdate(current, update.chatId, update.maxId),
        );
      }
    },
    [applyCommentUpdate, applyThreadUpdate],
  );

  const connected = useUpdatesSocket(authorized, handleUpdate, () => {
    void loadDialogs();
  });

  const openViewer = useCallback(
    (source: 'thread' | 'comments', messageId: number): void => {
      viewer.open(source, messageId);
      router.openViewer();
    },
    [router, viewer],
  );

  const closeViewer = useCallback((): void => {
    viewer.close();
    router.closeViewer();
  }, [router, viewer]);

  const openChat = useCallback(
    (chat: ChatDto, target?: { postId?: number; commentId?: number }): void => {
      const postId = target?.postId ?? null;
      const route: Route =
        postId === null
          ? { view: 'chat', chatId: chat.id, postId: null }
          : target?.commentId === undefined
            ? { view: 'chat', chatId: chat.id, postId }
            : { view: 'comments', chatId: chat.id, postId };
      router.navigateTo(route, postId === null ? undefined : { force: true });
    },
    [router],
  );
  const openForwardOrigin = useForwardOrigin(dialogs, openChat);

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
        openChat(chat, {
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
    closeViewer();
    forwarding.close();
    router.reset();
    setDialogs([]);
    setDialogsLoading(true);
    setMe(null);
    reset();
  }, [closeComments, closeThread, closeViewer, forwarding.close, reportError, reset, router]);

  // The home page has three faces: a public intro until Access admits the
  // browser, the QR login once Access is through but Telegram is not linked,
  // and the chat list once both are. The probe itself is `access === 'checking'`.
  if (access === 'anonymous') {
    return <LandingPage />;
  }

  if (access === 'checking') {
    return <CheckingAccess error={error} onRetry={retryAccess} />;
  }

  if (!authorized) {
    return <LoginScreen state={state} error={error} onPhone={onPhone} onCode={onCode} onPassword={onPassword} onRetry={onRetry} />;
  }

  return (
    <div className={`app${selected ? ' thread-open' : ''}`}>
      <aside className="sidebar">
        <header className="me">
          <UserMenu me={me} connected={connected} onSignOut={handleLogout} />
        </header>
        <ChatList dialogs={dialogs} activeChatId={selected?.id ?? null} loading={dialogsLoading} onSelect={openChat} />
      </aside>
      <TelegramLinkProvider handler={handleTelegramLink} onOpenForward={openForwardOrigin}>
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
            votingIds={comments.votingIds}
            pressingButtonIds={comments.pressingButtonIds}
            onBack={router.back}
            onLoadOlder={() => void comments.loadOlder()}
            onSend={comments.send}
            onAttach={comments.attach}
            onReact={comments.react}
            onForward={forwarding.open}
            onVote={comments.vote}
            onPressButton={comments.pressButton}
            onOpenMedia={(messageId) => openViewer('comments', messageId)}
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
            pressingButtonIds={threads.pressingButtonIds}
            readOutboxMaxId={threads.thread?.readOutboxMaxId ?? 0}
            unreadDividerId={threads.thread?.unreadDividerId ?? null}
            focusMessageId={threads.thread?.focusMessageId ?? null}
            positions={threads.positions}
            onBack={router.back}
            onLoadOlder={() => void threads.loadOlder()}
            onSend={threads.send}
            onAttach={threads.attach}
            onReact={threads.react}
            onForward={forwarding.open}
            onVote={threads.vote}
            onPressButton={threads.pressButton}
            onReadThrough={markRead}
            onOpenMedia={(messageId) => openViewer('thread', messageId)}
            onOpenComments={(message) => {
              if (selected) router.navigateTo({ view: 'comments', chatId: selected.id, postId: message.id });
            }}
          />
        )}
      </TelegramLinkProvider>
      {viewer.viewer ? (
        <MediaViewer messages={viewer.viewer.messages} initialMessageId={viewer.viewer.initialMessageId} onClose={closeViewer} />
      ) : null}
      {forwarding.target ? (
        <ForwardPicker messages={forwarding.target} dialogs={dialogs} onForward={forwarding.forward} onClose={forwarding.close} />
      ) : null}
      {error || notice ? (
        <div className="toasts">
          {error ? (
            <p className="toast" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="toast notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default App;
