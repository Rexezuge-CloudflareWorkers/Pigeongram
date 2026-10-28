import { useCallback, useRef, useState } from 'react';
import { ApiError, joinChat, readHistory, resolveChat } from './api';
import { findLinkedChat, launchTelegramApp, linkTarget, parseTelegramLink, targetAppLink } from './links';
import type { TelegramChatTarget } from './links';
import type { ChatPreview, ResolveRequest, SignedInNavigation, UseSignedInNavigationOptions } from './navigation-types';
import type { Route, RouteApplyOptions } from './routes';
import { routeForChat } from './routes';
import type { ChatDto, DialogDto, MessageDto, PeerId } from './types';
import { useChatNavigation } from './useChatNavigation';
import { useForwardOrigin } from './useForwardOrigin';
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

  /**
   * Hands a target the bridge could not resolve to the installed app, using
   * the link's own address where there is one.
   */
  const handOff = useCallback((target: TelegramChatTarget, request: ResolveRequest): void => {
    if (request.link !== undefined) {
      launchTelegramApp(request.link.deepLink, request.link.webUrl);
      return;
    }
    const link = targetAppLink(target);
    if (link !== null) launchTelegramApp(link.deepLink, link.webUrl);
  }, []);

  /**
   * Turns a resolved chat into a thread: a member opens normally, a public
   * chat the account is not in opens as a preview. A target with no public
   * username could not be joined from here, so it goes to the installed app.
   */
  const showResolved = useCallback(
    (chat: ChatDto, member: boolean, target: TelegramChatTarget, request: ResolveRequest): void => {
      if (!member && chat.username === null) {
        handOff(target, request);
        return;
      }
      registerTransient(chat);
      openChat(chat, {
        ...(request.postId !== undefined && { postId: request.postId }),
        ...(request.commentId !== undefined && { commentId: request.commentId }),
      });
      setPreview(
        member
          ? null
          : {
              chatId: chat.id,
              target,
              joining: false,
              requested: false,
            },
      );
    },
    [handOff, openChat, registerTransient],
  );

  /**
   * Resolves a username or marked id the loaded list does not carry. A 404 is
   * the unknown-chat case and hands the target to the installed app; every
   * other failure is reported.
   */
  const resolveTarget = useCallback(
    (target: TelegramChatTarget, request: ResolveRequest = {}): void => {
      const ticket = ++resolution.current;
      void resolveChat(target)
        .then((result) => {
          if (ticket !== resolution.current) return;
          showResolved(result.chat, result.member, target, request);
        })
        .catch((failure: unknown) => {
          if (ticket !== resolution.current) return;
          if (failure instanceof ApiError && failure.status === 404) {
            handOff(target, request);
            return;
          }
          onError(failure);
        });
    },
    [handOff, onError, showResolved],
  );

  const openForwardOrigin = useForwardOrigin(dialogs.all, openChat, resolveTarget);

  /**
   * Opens the archive: the screen of the chats the account archived.
   */
  const openArchive = useCallback((): void => {
    router.navigateTo({ view: 'archived' });
  }, [router]);

  const leaveArchive = useCallback(
    (): void => (router.route().view === 'archived' ? router.back() : onArchiveContext(false)),
    [router, onArchiveContext],
  );

  /**
   * Routes a click on a link inside a message: a chat this client already knows
   * opens in the thread (a linked post lands on that post), any other Telegram
   * chat is resolved and opened or previewed, and everything Telegram cannot
   * open here is handed to the installed app. `false` leaves ordinary web links
   * to the browser.
   */
  const handleTelegramLink = useCallback(
    (url: string): boolean => {
      const link = parseTelegramLink(url);
      if (link === null) return false;
      if (link.chat === null) {
        launchTelegramApp(link.deepLink, link.webUrl);
        return true;
      }
      const target = linkTarget(link.chat);
      const known = findLinkedChat(dialogs.all, target);
      if (known !== null) {
        openChat(known, {
          ...(link.postId !== null && { postId: link.postId }),
          ...(link.commentId !== null && { commentId: link.commentId }),
        });
        return true;
      }
      resolveTarget(target, {
        ...(link.postId !== null && { postId: link.postId }),
        ...(link.commentId !== null && { commentId: link.commentId }),
        link,
      });
      return true;
    },
    [dialogs.all, openChat, resolveTarget],
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
          onNotice('Your join request was sent. An admin has to approve it.');
          return;
        }
        if (result.status !== 'webview') return;
        onNotice('Telegram needs this join completed in its own app.');
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
    joinPreview,
    markRead,
    markAllRead,
  };
}
