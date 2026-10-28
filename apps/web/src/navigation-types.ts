import type { CommentsController } from './comments-controller';
import type { TelegramChatTarget, TelegramLink } from './links';
import type { Route } from './routes';
import type { ThreadController } from './thread-controller';
import type { ChatDto, MessageDto, MessageForwardDto, PeerId } from './types';
import type { DialogsController } from './useDialogs';
import type { MediaViewerController } from './useMediaViewer';
import type { Router } from './useRouter';

/**
 * The signed-in navigation's contract, split from `useSignedInNavigation.ts`
 * to keep the hook under the god-file cap (the same shape as
 * `thread-view-props.ts`).
 */

/**
 * A chat the bridge resolved but the account has not joined: the thread reads
 * as a preview, with Join where the composer would be.
 *
 * It is memory-only, exactly like the transient dialogs beside it: a reload
 * has no dialog to resolve it again, because Telegram is the only source for
 * that and the account's own list does not carry the chat.
 */
export interface ChatPreview {
  chatId: PeerId;
  /**
   * The bridge address the chat was resolved by, so Join can address it the
   * same way even when its username is not what the link carried.
   */
  target: TelegramChatTarget;
  /**
   * A join request is in flight; the Join button is disabled.
   */
  joining: boolean;
  /**
   * Telegram accepted the join request and an admin has to approve it.
   */
  requested: boolean;
}

export interface UseSignedInNavigationOptions {
  /**
  The live dialogs: the router looks its chat up before React has committed
  the boot read.
  */
  dialogs: Pick<DialogsController, 'all' | 'find' | 'applyRead' | 'applyReadAll' | 'load' | 'loadArchive'>;
  threads: ThreadController;
  comments: CommentsController;
  /**
  Whether the sidebar is browsing the archive. The route owns the archive
  screen, and a chat opened from it keeps the context.
  */
  onArchiveContext: (archived: boolean) => void;
  /**
  Reports a failed resolution or join. A chat Telegram does not know is not a
  failure: it is handed to the installed app.
  */
  onError: (failure: unknown) => void;
  /**
  Shows the outcome of a join that needs the reader's attention (a pending
  request, or a guard bot's web view).
  */
  onNotice: (text: string) => void;
}

export interface SignedInNavigation {
  router: Router;
  /**
   * Whether the route names something the signed-in account can open. The boot
   * asks before it reads the archive for a shared link.
   */
  canOpen: (route: Route) => boolean;
  viewer: MediaViewerController;
  openViewer: (source: 'thread' | 'comments', messageId: number) => void;
  closeViewer: () => void;
  openChat: (chat: ChatDto, target?: { postId?: number; commentId?: number }) => void;
  /**
   * Opens a search hit: the message's chat at the message itself. A chat the
   * loaded list does not carry (a global hit) is kept as a transient dialog
   * for this session, so the route and the thread can resolve it.
   */
  openSearchResult: (chat: ChatDto, message: MessageDto) => void;
  openForwardOrigin: (forward: MessageForwardDto) => void;
  openArchive: () => void;
  leaveArchive: () => void;
  handleTelegramLink: (url: string) => boolean;
  /**
   * The open chat as a preview, or null when it is in the account's list. The
   * thread renders Join instead of a composer then.
   */
  preview: ChatPreview | null;
  /**
   * Joins the open preview chat. A successful join replaces the preview with
   * the chat Telegram returned and refreshes the list; a pending request or a
   * guard bot's web view stays on the preview and is reported.
   */
  joinPreview: () => void;
  markRead: (chatId: PeerId, maxId: number) => void;
  /**
   * Marks the whole chat read, including an unread backlog the thread has not
   * loaded. A no-op when the chat has nothing unread.
   */
  markAllRead: (chatId: PeerId) => void;
}

/**
 * What a resolved target should open, beyond the chat itself.
 */
export interface ResolveRequest {
  postId?: number;
  commentId?: number;
  /**
   * The link that asked for the chat, whose own address is the most faithful
   * handoff when the bridge cannot resolve it.
   */
  link?: TelegramLink;
}
