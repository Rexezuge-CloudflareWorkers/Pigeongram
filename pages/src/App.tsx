import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchBootstrap, logout, readHistory } from './api';
import { ArchiveBar } from './components/ArchiveBar';
import { ChatList } from './components/ChatList';
import { ForwardPicker } from './components/ForwardPicker';
import { HomeScreen } from './components/HomeScreen';
import { MediaViewer } from './components/MediaViewer';
import { ThreadPane } from './components/ThreadPane';
import { Toasts } from './components/Toasts';
import { UserMenu } from './components/UserMenu';
import { useLoginFlow, useUpdatesSocket } from './hooks';
import { findLinkedChat, launchTelegramApp, parseTelegramLink } from './links';
import { usePwa } from './pwa/usePwa';
import type { Route, RouteApplyOptions } from './routes';
import { routeForChat } from './routes';
import { TelegramLinkProvider } from './telegram-links';
import type { ChatDto, MeDto, MessageDto, PeerId, UpdateEvent } from './types';
import { useAppHeight } from './useAppHeight';
import { useChatNavigation } from './useChatNavigation';
import { useComments } from './useComments';
import { useDialogs } from './useDialogs';
import { useForwarding } from './useForwarding';
import { useForwardOrigin } from './useForwardOrigin';
import { useMediaViewer } from './useMediaViewer';
import { useRouter } from './useRouter';
import { useThread } from './useThread';

export function App() {
  useAppHeight();
  const { state, access, error, reportError, retryAccess, onPhone, onCode, onPassword, onRetry, reset } = useLoginFlow();
  const pwa = usePwa();

  const [me, setMe] = useState<MeDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
  Whether the sidebar is browsing the archive. The route owns the archive
  screen (`/archived`), and a chat opened from it keeps the context: the list
  is the chat's, so reading one of its chats does not leave it behind.
  */
  const [archiveContext, setArchiveContext] = useState(false);

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
  The chat list: the main chats and the archive, in one list. The controller
  owns both reads and the live updates, so every lookup of a chat — the
  router, the thread, the read receipts — finds it in the same place.
  */
  const dialogs = useDialogs({ onError: reportError, onNotice: notify });
  const {
    all: allDialogs,
    main: mainDialogs,
    archived: archivedDialogs,
    loading: dialogsLoading,
    archiveLoading,
    ref: dialogsRef,
    find: findDialog,
    apply: applyDialogs,
    load: loadDialogs,
    loadArchive,
    applyUpdate,
    applyRead,
    setArchived,
    clear: clearDialogs,
  } = dialogs;

  /**
  A message the caller sent (or uploaded) was accepted: fold it into the
  dialogs. The thread's own copy is the controller's.
  */
  const handleSent = useCallback(
    (message: MessageDto): void => {
      applyUpdate({ type: 'new_message', message }, message.chatId);
    },
    [applyUpdate],
  );

  const threads = useThread({ onSent: handleSent, onError: reportError, onNotice: notify });
  const forwarding = useForwarding(handleSent, threads.applyUpdate, notify);
  // Stable helpers, so the callbacks that depend on them keep their identity.
  const applyThreadUpdate = threads.applyUpdate;
  const closeThread = threads.close;
  const clearThreadPending = threads.clearPending;
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
        applyUpdate({ type: 'new_message', message: comment }, null);
      }
    },
    [applyUpdate, bumpCommentCount],
  );

  const comments = useComments({ onCommentSent: handleCommentSent, onError: reportError, onNotice: notify });
  const closeComments = comments.close;
  const clearCommentsPending = comments.clearPending;
  const applyCommentUpdate = comments.applyUpdate;

  const selectedRef = useRef<PeerId | null>(null);
  const selected = threads.thread?.chat ?? null;
  // The open chat's presence comes from the list, which the live updates keep current.
  const selectedPresence = selected ? (findDialog(selected.id)?.chat.presence ?? null) : null;
  // Whether the open chat sits in the archive: the thread header offers the
  // move in the direction the chat is not in.
  const selectedArchived = selected ? (findDialog(selected.id)?.archived ?? false) : false;
  // What the sidebar lists: the archive while the reader is on its screen or
  // in one of its chats; a chat brought back out of the archive hands the
  // sidebar back to the chat list, where the chat now lives.
  const showArchive = archiveContext && (selected === null || selectedArchived);
  const authorized = state?.authorized ?? false;

  const viewer = useMediaViewer({ thread: threads.thread, comments: comments.thread });
  const navigate = useChatNavigation({ dialogs: dialogsRef, threads, comments });
  /**
  The route drives the screen, and the archive is a screen of its own: the
  sidebar shows the archived chats while the route names it or while the open
  chat came from it.
  */
  const applyRoute = useCallback(
    (route: Route, options: RouteApplyOptions): Promise<void> => {
      const target = route.view === 'chat' || route.view === 'comments' ? findDialog(route.chatId) : null;
      setArchiveContext(route.view === 'archived' || target?.archived === true);
      // The archive is read when it is opened, not before: the main list is the
      // account's chats, and the archive is a screen the reader asks for.
      if (route.view === 'archived') void loadArchive();
      return navigate(route, options);
    },
    [findDialog, loadArchive, navigate],
  );
  const canOpen = useCallback(
    (route: Route): boolean =>
      route.view === 'list' || route.view === 'archived' || dialogsRef.current.some((dialog) => dialog.chat.id === route.chatId),
    [dialogsRef],
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
        // The account and the chat list come back in one request: the engine
        // reads them at the same time, where separate requests would queue
        // behind each other.
        const boot = await fetchBootstrap();
        setMe(boot.me ?? state?.me ?? null);
        applyDialogs(boot.dialogs);
      } catch {
        // The combined read failed; the chat list on its own may still work,
        // and it reports its own failure if it does not.
        await loadDialogs();
      }
      // A shared link may name a chat in the archive, which the chat list does
      // not carry: the archive is read before the route gives up on it.
      const target = router.route();
      if (target.view === 'chat' && !canOpen(target)) await loadArchive();
      router.boot();
    })();
  }, [authorized, state?.me, reportError, applyDialogs, loadDialogs, loadArchive, canOpen, router.boot, router.route]);

  const handleUpdate = useCallback(
    (update: UpdateEvent): void => {
      // The comments screen and the open thread listen to the same stream:
      // each folds in what belongs to it and lets everything else pass.
      applyCommentUpdate(update);
      applyThreadUpdate(update);
      applyUpdate(update, selectedRef.current);
    },
    [applyCommentUpdate, applyThreadUpdate, applyUpdate],
  );

  const connected = useUpdatesSocket(authorized, handleUpdate, (resync) => {
    // The boot read the chat list already; only a dropped connection means
    // the list may be stale.
    if (resync) void loadDialogs();
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
      router.navigateTo(routeForChat(chat.id, postId, target?.commentId), postId === null ? undefined : { force: true });
    },
    [router],
  );
  const openForwardOrigin = useForwardOrigin(allDialogs, openChat);

  /**
  Opens the archive: the screen of the chats the account archived.
  */
  const openArchive = useCallback((): void => {
    router.navigateTo({ view: 'archived' });
  }, [router]);

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
      const chat = link.chat === null ? null : findLinkedChat(allDialogs, link.chat);
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
    [allDialogs, openChat],
  );

  /**
  Persists what the user read, as reported by the thread's scroll position:
  the dialog's badge and watermark move immediately, the receipt is
  best-effort, and the server's own `read` update settles the exact count.
  */
  const markRead = useCallback(
    (chatId: PeerId, maxId: number): void => {
      const open = threads.thread && threads.thread.chat.id === chatId ? threads.thread : null;
      const boundary = open?.readInboxMaxId ?? findDialog(chatId)?.readInboxMaxId ?? 0;
      if (maxId <= boundary) return;
      setReadWatermark(chatId, maxId);
      applyRead(chatId, maxId, open?.messages ?? []);
      void readHistory(chatId, maxId).catch(() => {
        // Read receipts are best-effort; the next open retries.
      });
    },
    [applyRead, findDialog, setReadWatermark, threads.thread],
  );

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await logout();
    } catch (failure) {
      reportError(failure);
    }
    closeThread();
    closeComments();
    clearThreadPending();
    clearCommentsPending();
    closeViewer();
    forwarding.close();
    router.reset();
    setArchiveContext(false);
    clearDialogs();
    setMe(null);
    reset();
  }, [
    clearCommentsPending,
    clearThreadPending,
    closeComments,
    closeThread,
    closeViewer,
    clearDialogs,
    forwarding.close,
    reportError,
    reset,
    router,
  ]);

  // The home page has four faces — the public intro, the offline screen, the
  // QR login and the chat list — and the picker lives in `HomeScreen`.
  if (access !== 'authenticated' || !authorized) {
    return (
      <HomeScreen
        access={access}
        state={state}
        error={error}
        onRetryAccess={retryAccess}
        onPhone={onPhone}
        onCode={onCode}
        onPassword={onPassword}
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className={`app${selected ? ' thread-open' : ''}`}>
      <aside className="sidebar">
        <header className="me">
          <UserMenu me={me} connected={connected} pwa={pwa} onSignOut={handleLogout} onOpenArchive={openArchive} />
        </header>
        {showArchive ? <ArchiveBar count={archivedDialogs.length} onBack={router.back} /> : null}
        <ChatList
          dialogs={showArchive ? archivedDialogs : mainDialogs}
          activeChatId={selected?.id ?? null}
          loading={showArchive ? archiveLoading : dialogsLoading}
          pending={threads.pending}
          onSelect={openChat}
          emptyLabel={showArchive ? 'No archived chats.' : undefined}
        />
      </aside>
      <TelegramLinkProvider handler={handleTelegramLink} onOpenForward={openForwardOrigin}>
        <ThreadPane
          threads={threads}
          comments={comments}
          selected={selected}
          presence={selectedPresence}
          archived={selectedArchived}
          onSetArchived={async (archived) => {
            if (selected) await setArchived(selected.id, archived);
          }}
          onBack={router.back}
          onForward={forwarding.open}
          onOpenMedia={openViewer}
          onReadThrough={markRead}
          onOpenComments={(message) => {
            if (selected) router.navigateTo({ view: 'comments', chatId: selected.id, postId: message.id });
          }}
        />
      </TelegramLinkProvider>
      {viewer.viewer ? (
        <MediaViewer messages={viewer.viewer.messages} initialMessageId={viewer.viewer.initialMessageId} onClose={closeViewer} />
      ) : null}
      {forwarding.target ? (
        <ForwardPicker messages={forwarding.target} dialogs={allDialogs} onForward={forwarding.forward} onClose={forwarding.close} />
      ) : null}
      <Toasts error={error} notice={notice} />
    </div>
  );
}

export default App;
