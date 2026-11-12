import { useCallback, useRef, useState } from 'react';
import { ServiceError } from '@rexezuge/errors';
import { joinChat, readHistory, resolveChat } from './api';
import { launchTelegramApp, targetAppLink } from './links';
import type { ChatPreview, SignedInNavigation, UseSignedInNavigationOptions } from './navigation-types';
import type { Route, RouteApplyOptions } from './routes';
import { routeForChat } from './routes';
import type { ChatDto, DialogDto, MessageDto, PeerId } from './types';
import { useChatNavigation } from './useChatNavigation';
import { useLinkRouting } from './useLinkRouting';
import { useMediaViewer } from './useMediaViewer';
import { useRouter } from './useRouter';

/**
 * The signed-in screen's navigation: the route the URL names, the archive as a
 * screen of its own, the media viewer's history layer, and the actions that
 * move the reader between chats — a chat-list click, a Telegram link, a
 * forward's origin, and a read receipt.
 *
 * It composes the existing hooks (`useRouter`, `useChatNavigation`,
 * `useMediaViewer`) so the shell above it only wires the data plane and paints
 * the screen. The link and preview half is the reason a chat outside the
 * loaded list can be opened at all; a preview is memory-only, because Telegram
 * is the only source that can resolve it again.
 */

export function useSignedInNavigation({
  dialogs,
  threads,
  comments,
  onArchiveContext,
  onError,
  onNotice,
}: UseSignedInNavigationOptions): SignedInNavigation {
  const { find: findDialog, applyRead, applyReadAll, load, loadArchive } = dialogs;
  const viewer = useMediaViewer({ thread: threads.thread, comments: comments.thread });
  /**
   * The chats a search found outside the loaded list, as dialogs good enough
   * for the thread to open. They are memory-only: the route they are on cannot
   * survive a reload, because the list would have to be read to resolve them
   * again, and Telegram is the only source for that.
   */
  const transientDialogs = useRef(new Map<PeerId, DialogDto>());
  /**
   * The latest link or forward resolution. A slower answer must not take the
   * reader away from a screen they moved to after the click.
   */
  const resolution = useRef(0);
  const resolveDialog = useCallback(
    (chatId: PeerId): DialogDto | undefined => findDialog(chatId) ?? transientDialogs.current.get(chatId),
    [findDialog],
  );
  const navigate = useChatNavigation({ findDialog: resolveDialog, threads, comments });

  /**
   * The preview chat the thread is showing, if any. It sits outside the list,
   * so it is shown only while its chat is the open one — a route away from it
   * hides the mark without forgetting which chat was resolved.
   */
  const [preview, setPreview] = useState<ChatPreview | null>(null);
  const openChatId = threads.thread?.chat.id ?? null;
  const activePreview = preview !== null && preview.chatId === openChatId ? preview : null;

  /**
   * The route drives the screen, and the archive is a screen of its own: the
   * sidebar shows the archived chats while the route names it or while the open
   * chat came from it.
   */
  const applyRoute = useCallback(
    (route: Route, options: RouteApplyOptions): Promise<void> => {
      resolution.current += 1;
      const target = route.view === 'chat' || route.view === 'comments' ? resolveDialog(route.chatId) : null;
      onArchiveContext(route.view === 'archived' || target?.archived === true);
      // The archive is read when it is opened, not before: the main list is the
      // account's chats, and the archive is a screen the reader asks for.
      if (route.view === 'archived') void loadArchive();
      return navigate(route, options);
    },
    [resolveDialog, loadArchive, navigate, onArchiveContext],
  );
  const canOpen = useCallback(
    (route: Route): boolean => route.view === 'list' || route.view === 'archived' || resolveDialog(route.chatId) !== undefined,
    [resolveDialog],
  );
  const router = useRouter({
    onRoute: applyRoute,
    canOpen,
    onViewerEnter: viewer.reopen,
    onViewerLeave: viewer.close,
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

  /**
   * Keeps a chat outside the loaded list addressable: the route, the thread and
   * the read receipts all look a chat up in one place.
   */
  const registerTransient = useCallback(
    (chat: ChatDto): void => {
      if (findDialog(chat.id) === undefined) {
        transientDialogs.current.set(chat.id, {
          chat,
          lastMessage: null,
          unread: 0,
          readInboxMaxId: 0,
          readOutboxMaxId: 0,
          pinned: false,
          muted: false,
          archived: false,
        });
      }
    },
    [findDialog],
  );

  const prepareInitialRoute = useCallback(
    async (route: Route): Promise<void> => {
      if (route.view !== 'chat' && route.view !== 'comments') return;
      if (resolveDialog(route.chatId) !== undefined) return;
      try {
        const result = await resolveChat({ chatId: route.chatId });
        if (result.member) registerTransient(result.chat);
      } catch (failure) {
        if (failure instanceof ServiceError && failure.status === 404) return;
        onError(failure);
      }
    },
    [onError, registerTransient, resolveDialog],
  );

  const openChat = useCallback(
    (chat: ChatDto, target?: { postId?: number; commentId?: number }): void => {
      resolution.current += 1;
      // A chat-list click leaves a preview behind; opening the preview itself
      // keeps it (the caller sets it after this call).
      setPreview((current) => (current === null || current.chatId === chat.id ? current : null));
      const postId = target?.postId ?? null;
      router.navigateTo(routeForChat(chat.id, postId, target?.commentId), postId === null ? undefined : { force: true });
    },
    [router],
  );

  /**
   * Opens a search hit at its message. The transient dialog is registered
   * before the route applies, so `canOpen` and the thread's own lookup find it
   * in the same tick.
   */
  const openSearchResult = useCallback(
    (chat: ChatDto, message: MessageDto): void => {
      registerTransient(chat);
      openChat(chat, { postId: message.id });
    },
    [openChat, registerTransient],
  );

  const { openForwardOrigin, handleTelegramLink, invite, joinInvite, dismissInvite } = useLinkRouting({
    dialogs: dialogs.all,
    resolutionRef: resolution,
    openChat,
    registerChat: registerTransient,
    setPreview,
    reload: load,
    onError,
    onNotice,
  });

  /**
   * Opens the archive: the screen of the chats the account archived.
   *
   * A thread that is already open stays open: switching to the archive only
   * changes the sidebar, the same way "Back To Chats" leaves an open archived
   * chat in place. Without an open thread the archive is its own screen.
   */
  const openArchive = useCallback((): void => {
    if (openChatId !== null) {
      onArchiveContext(true);
      void loadArchive();
      return;
    }
    router.navigateTo({ view: 'archived' });
  }, [loadArchive, onArchiveContext, openChatId, router]);

  const leaveArchive = useCallback(
    (): void => (router.route().view === 'archived' ? router.back() : onArchiveContext(false)),
    [router, onArchiveContext],
  );

  /**
   * Joins the open preview chat. The resolved DTO is folded into the thread in
   * place, so the composer appears without re-reading the window; the chat list
   * is read again because the chat now belongs there.
   */
  const joinPreview = useCallback((): void => {
    const current = activePreview;
    if (current === null || current.joining || current.requested) return;
    setPreview((state) => (state !== null && state.chatId === current.chatId ? { ...state, joining: true } : state));
    void joinChat(current.target)
      .then((result) => {
        if (result.status === 'joined' && result.chat !== null) {
          const chat = result.chat;
          threads.updateChat(chat);
          const dialog = transientDialogs.current.get(chat.id);
          if (dialog !== undefined) transientDialogs.current.set(chat.id, { ...dialog, chat });
          setPreview(null);
          void load();
          return;
        }
        if (result.status === 'request_sent') {
          setPreview((state) => (state !== null && state.chatId === current.chatId ? { ...state, requested: true } : state));
          onNotice('Your Join Request Was Sent. An Admin Has To Approve It.');
          return;
        }
        if (result.status !== 'webview') return;
        onNotice('Telegram Needs This Join Completed In Its Own App.');
        const link = targetAppLink(current.target);
        if (link !== null) launchTelegramApp(link.deepLink, link.webUrl);
      })
      .catch(onError)
      .finally(() => {
        setPreview((state) => (state !== null && state.chatId === current.chatId ? { ...state, joining: false } : state));
      });
  }, [activePreview, threads, load, onNotice, onError]);

  /**
   * Persists what the user read, as reported by the thread's scroll position:
   * the dialog's badge and watermark move immediately, the receipt is
   * best-effort, and the server's own `read` update settles the exact count.
   *
   * A preview is not in the account's chat list and its messages were not sent
   * to this account, so nothing is marked read there.
   */
  const markRead = useCallback(
    (chatId: PeerId, maxId: number): void => {
      if (activePreview?.chatId === chatId) return;
      const open = threads.thread && threads.thread.chat.id === chatId ? threads.thread : null;
      const boundary = open?.readInboxMaxId ?? findDialog(chatId)?.readInboxMaxId ?? 0;
      if (maxId <= boundary) return;
      threads.setReadWatermark(chatId, maxId);
      applyRead(chatId, maxId, open?.messages ?? []);
      void readHistory(chatId, maxId).catch(() => {
        // Read receipts are best-effort; the next open retries.
      });
    },
    [activePreview, applyRead, findDialog, threads],
  );

  /**
   * Marks the whole chat read: a chat-list action, or the thread's jump to the
   * bottom. The unread backlog is not necessarily loaded, so the receipt is sent
   * with no max id — the bridge marks everything to Telegram's own newest message
   * — while the lists and the open thread move to the newest id the client knows.
   */
  const markAllRead = useCallback(
    (chatId: PeerId): void => {
      if (activePreview?.chatId === chatId) return;
      const open = threads.thread && threads.thread.chat.id === chatId ? threads.thread : null;
      const dialog = findDialog(chatId);
      const current = Math.max(open?.readInboxMaxId ?? 0, dialog?.readInboxMaxId ?? 0);
      const newest = Math.max(open?.latestMessageId ?? 0, open?.messages.at(-1)?.id ?? 0, dialog?.lastMessage?.id ?? 0);
      if ((dialog?.unread ?? 0) === 0 && newest <= current) return;
      const boundary = Math.max(newest, current);
      threads.setReadWatermark(chatId, boundary);
      applyReadAll(chatId, boundary);
      void readHistory(chatId).catch(() => {
        // Read receipts are best-effort; the next open retries.
      });
    },
    [activePreview, applyReadAll, findDialog, threads],
  );

  return {
    router,
    prepareInitialRoute,
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
    preview: activePreview,
    invite,
    joinInvite,
    dismissInvite,
    joinPreview,
    markRead,
    markAllRead,
  };
}
