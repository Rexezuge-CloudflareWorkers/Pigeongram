import { useCallback } from 'react';
import { readHistory } from './api';
import type { CommentsController } from './comments-controller';
import { findLinkedChat, launchTelegramApp, parseTelegramLink } from './links';
import type { Route, RouteApplyOptions } from './routes';
import { routeForChat } from './routes';
import type { ThreadController } from './thread-controller';
import type { ChatDto, MessageForwardDto, PeerId } from './types';
import { useChatNavigation } from './useChatNavigation';
import type { DialogsController } from './useDialogs';
import { useForwardOrigin } from './useForwardOrigin';
import type { MediaViewerController } from './useMediaViewer';
import { useMediaViewer } from './useMediaViewer';
import type { Router } from './useRouter';
import { useRouter } from './useRouter';

/**
 * The signed-in screen's navigation: the route the URL names, the archive as a
 * screen of its own, the media viewer's history layer, and the actions that
 * move the reader between chats — a chat-list click, a Telegram link, a
 * forward's origin, and a read receipt.
 *
 * It composes the existing hooks (`useRouter`, `useChatNavigation`,
 * `useMediaViewer`) so the shell above it only wires the data plane and paints
 * the screen.
 */

interface UseSignedInNavigationOptions {
  /**
  The live dialogs: the router looks its chat up before React has committed
  the boot read.
  */
  dialogs: Pick<DialogsController, 'all' | 'find' | 'ref' | 'applyRead' | 'loadArchive'>;
  threads: ThreadController;
  comments: CommentsController;
  /**
  Whether the sidebar is browsing the archive. The route owns the archive
  screen, and a chat opened from it keeps the context.
  */
  onArchiveContext: (archived: boolean) => void;
}

export interface SignedInNavigation {
  router: Router;
  /**
  Whether the route names something the signed-in account can open. The boot
  asks before it reads the archive for a shared link.
  */
  canOpen: (route: Route) => boolean;
  viewer: MediaViewerController;
  openViewer: (source: 'thread' | 'comments', messageId: number) => void;
  closeViewer: () => void;
  openChat: (chat: ChatDto, target?: { postId?: number; commentId?: number }) => void;
  openForwardOrigin: (forward: MessageForwardDto) => void;
  openArchive: () => void;
  leaveArchive: () => void;
  handleTelegramLink: (url: string) => boolean;
  markRead: (chatId: PeerId, maxId: number) => void;
}

export function useSignedInNavigation({ dialogs, threads, comments, onArchiveContext }: UseSignedInNavigationOptions): SignedInNavigation {
  const { find: findDialog, ref: dialogsRef, applyRead, loadArchive } = dialogs;
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
      onArchiveContext(route.view === 'archived' || target?.archived === true);
      // The archive is read when it is opened, not before: the main list is the
      // account's chats, and the archive is a screen the reader asks for.
      if (route.view === 'archived') void loadArchive();
      return navigate(route, options);
    },
    [findDialog, loadArchive, navigate, onArchiveContext],
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
  const openForwardOrigin = useForwardOrigin(
    // The forward picker and the links both look a chat up in one list; the
    // controller already keeps every chat there.
    dialogs.all,
    openChat,
  );

  /**
  Opens the archive: the screen of the chats the account archived.
  */
  const openArchive = useCallback((): void => {
    router.navigateTo({ view: 'archived' });
  }, [router]);

  const leaveArchive = useCallback(
    (): void => (router.route().view === 'archived' ? router.back() : onArchiveContext(false)),
    [router, onArchiveContext],
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
      const chat = link.chat === null ? null : findLinkedChat(dialogs.all, link.chat);
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
    [dialogs.all, openChat],
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
      threads.setReadWatermark(chatId, maxId);
      applyRead(chatId, maxId, open?.messages ?? []);
      void readHistory(chatId, maxId).catch(() => {
        // Read receipts are best-effort; the next open retries.
      });
    },
    [applyRead, findDialog, threads],
  );

  return {
    router,
    canOpen,
    viewer,
    openViewer,
    closeViewer,
    openChat,
    openForwardOrigin,
    openArchive,
    leaveArchive,
    handleTelegramLink,
    markRead,
  };
}
