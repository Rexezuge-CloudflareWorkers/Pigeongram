import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchBootstrap, logout } from '../api';
import { useCallHost } from '../calls/host';
import type { PwaState } from '../pwa/usePwa';
import type { SearchScope } from '../search';
import { TelegramLinkProvider } from '../telegram-links';
import type { ChatDto, MeDto, MessageDto, PeerId, UpdateEvent } from '../types';
import { useComments } from '../useComments';
import { useDialogs } from '../useDialogs';
import { useForwarding } from '../useForwarding';
import { useSignedInNavigation } from '../useSignedInNavigation';
import { useThread } from '../useThread';
import { ArchiveBar } from './ArchiveBar';
import { ChatList } from './ChatList';
import { ForwardPicker } from './ForwardPicker';
import { Icon } from './Icon';
import { MediaViewer } from './MediaViewer';
import { SearchOverlay } from './SearchOverlay';
import { ThreadPane } from './ThreadPane';
import { Toasts } from './Toasts';
import { UserMenu } from './UserMenu';

/**
The signed-in shell: the chat list and its archive, the thread and comments
panes, the media viewer, the forward picker, the call overlay and the account
menu — with the controllers that wire them together. `App` keeps the login
flow, the screen picker and the app-wide behaviors, and the shell's routing
lives in `useSignedInNavigation`; this keeps the account plane, so neither file
is one feature away from the god-file cap.
*/

interface SignedInShellProps {
  /**
  The account the login flow already read. The boot's own read replaces it.
  */
  initialMe: MeDto | null;
  /**
  The login flow's failure, shown by the global toast.
  */
  error: string | null;
  /**
  The installable app's offer, shown by the account menu.
  */
  pwa: PwaState;
  /**
  Reports a failure to the login flow's toast (and drops an expired Access
  session back to the public intro).
  */
  onError: (failure: unknown) => void;
  /**
  Drops the login snapshot after a sign-out.
  */
  onSignedOut: () => void;
}

export function SignedInShell({ initialMe, error, pwa, onError, onSignedOut }: SignedInShellProps) {
  const [me, setMe] = useState<MeDto | null>(initialMe);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
  Whether the sidebar is browsing the archive. The route owns the archive
  screen (`/archived`), and a chat opened from it keeps the context: the list
  is the chat's, so reading one of its chats does not leave it behind.
  */
  const [archiveContext, setArchiveContext] = useState(false);
  /**
  What the search overlay was opened for: the scope it starts in and, for a
  hashtag, the query it carries. Null while the overlay is closed.
  */
  const [search, setSearch] = useState<{ scope: SearchScope; query?: string } | null>(null);

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
  const dialogs = useDialogs({ onError, onNotice: notify });
  const {
    all: allDialogs,
    main: mainDialogs,
    archived: archivedDialogs,
    loading: dialogsLoading,
    archiveLoading,
    find: findDialog,
    apply: applyDialogs,
    load: loadDialogs,
    loadArchive,
    applyUpdate,
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

  const threads = useThread({ onSent: handleSent, onError, onNotice: notify });
  const forwarding = useForwarding(handleSent, threads.applyUpdate, notify);
  // Stable helpers, so the callbacks that depend on them keep their identity.
  const applyThreadUpdate = threads.applyUpdate;
  const closeThread = threads.close;
  const clearThreadPending = threads.clearPending;
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

  const comments = useComments({ onCommentSent: handleCommentSent, onError, onNotice: notify });
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

  /**
  The search overlay's entry points: the sidebar searches every chat, the
  thread header searches the open one, and a tapped hashtag searches every chat
  for the tag. A result opens at its message; the navigation hook registers a
  chat outside the list as transient so the route can find it.
  */
  const openGlobalSearch = useCallback((): void => setSearch({ scope: { kind: 'all' } }), []);
  const openThreadSearch = useCallback((): void => {
    if (selected !== null) setSearch({ scope: { kind: 'chat', chatId: selected.id } });
  }, [selected]);
  const handleHashtag = useCallback((hashtag: string): void => {
    setSearch({ scope: { kind: 'all' }, query: hashtag });
  }, []);

  const {
    router: { boot: bootRouter, route: currentRoute, reset: resetRouter },
    router,
    canOpen,
    viewer,
    openViewer,
    closeViewer,
    openChat,
    openSearchResult,
    openForwardOrigin,
    openArchive,
    leaveArchive,
    handleTelegramLink,
    markRead,
    markAllRead,
  } = useSignedInNavigation({ dialogs, threads, comments, onArchiveContext: setArchiveContext });

  const handleSearchResult = useCallback(
    (message: MessageDto, chat: ChatDto): void => {
      setSearch(null);
      openSearchResult(chat, message);
    },
    [openSearchResult],
  );

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest selection. A layout effect runs with the commit, so
  // no socket event can observe the previous chat after a switch.
  useLayoutEffect(() => {
    selectedRef.current = selected?.id ?? null;
  }, [selected]);

  // ---- signed-in data: dialogs, live updates, thread ----------------------

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      if (initialMe) setMe(initialMe);
      try {
        // The account and the chat list come back in one request: the engine
        // reads them at the same time, where separate requests would queue
        // behind each other.
        const boot = await fetchBootstrap();
        setMe(boot.me ?? initialMe ?? null);
        applyDialogs(boot.dialogs);
      } catch {
        // The combined read failed; the chat list on its own may still work,
        // and it reports its own failure if it does not.
        await loadDialogs();
      }
      // A shared link may name a chat in the archive, which the chat list does
      // not carry: the archive is read before the route gives up on it.
      const target = currentRoute();
      if (target.view === 'chat' && !canOpen(target)) await loadArchive();
      bootRouter();
    })();
  }, [initialMe, applyDialogs, loadDialogs, loadArchive, canOpen, bootRouter, currentRoute]);

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

  /**
   * The calls own the updates socket: a call's signalling rides it, and a
   * call arrives as an ordinary bridge event.
   */
  const findChat = useCallback((chatId: PeerId) => findDialog(chatId)?.chat ?? null, [findDialog]);
  const calls = useCallHost({ enabled: true, onUpdate: handleUpdate, onResync: loadDialogs, findChat, onError });
  const connected = calls.connected;

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await logout();
    } catch (failure) {
      onError(failure);
    }
    closeThread();
    closeComments();
    clearThreadPending();
    clearCommentsPending();
    closeViewer();
    forwarding.close();
    resetRouter();
    setArchiveContext(false);
    clearDialogs();
    setMe(null);
    onSignedOut();
  }, [
    clearCommentsPending,
    clearThreadPending,
    closeComments,
    closeThread,
    closeViewer,
    clearDialogs,
    forwarding.close,
    onError,
    onSignedOut,
    resetRouter,
  ]);

  return (
    <div className={`app${selected ? ' thread-open' : ''}`}>
      <aside className="sidebar">
        <header className="me">
          <UserMenu me={me} connected={connected} pwa={pwa} onSignOut={handleLogout} onOpenArchive={openArchive} />
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={openGlobalSearch}
            aria-label="Search messages"
          >
            <Icon name="search" />
          </button>
        </header>
        {showArchive ? <ArchiveBar count={archivedDialogs.length} onBack={leaveArchive} /> : null}
        <ChatList
          dialogs={showArchive ? archivedDialogs : mainDialogs}
          activeChatId={selected?.id ?? null}
          loading={showArchive ? archiveLoading : dialogsLoading}
          pending={threads.pending}
          onSelect={openChat}
          onMarkRead={markAllRead}
          emptyLabel={showArchive ? 'No archived chats.' : undefined}
        />
      </aside>
      <TelegramLinkProvider handler={handleTelegramLink} onHashtag={handleHashtag} onOpenForward={openForwardOrigin}>
        <ThreadPane
          threads={threads}
          comments={comments}
          selected={selected}
          presence={selectedPresence}
          archived={selectedArchived}
          canArchive={selected !== null && findDialog(selected.id) !== undefined}
          onSetArchived={async (archived) => {
            if (selected) await setArchived(selected.id, archived);
          }}
          onBack={router.back}
          calls={calls}
          onSearch={openThreadSearch}
          onForward={forwarding.open}
          onOpenMedia={openViewer}
          onReadThrough={markRead}
          onMarkAllRead={markAllRead}
          onOpenComments={(message) => {
            if (selected) router.navigateTo({ view: 'comments', chatId: selected.id, postId: message.id });
          }}
        />
        {viewer.viewer ? (
          <MediaViewer messages={viewer.viewer.messages} initialMessageId={viewer.viewer.initialMessageId} onClose={closeViewer} />
        ) : null}
      </TelegramLinkProvider>
      {forwarding.target ? (
        <ForwardPicker messages={forwarding.target} dialogs={allDialogs} onForward={forwarding.forward} onClose={forwarding.close} />
      ) : null}
      {search ? (
        <SearchOverlay
          chat={selected}
          initialScope={search.scope}
          initialQuery={search.query}
          onOpenResult={handleSearchResult}
          onClose={() => setSearch(null)}
        />
      ) : null}
      {calls.overlay}
      <Toasts error={error} notice={notice} />
    </div>
  );
}
