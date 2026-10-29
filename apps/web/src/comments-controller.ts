import type { PendingMessage } from './outbox';
import type { CommentsThread } from './state';
import type { ChatDto, GetCommentsResult, MessageButtonDto, MessageDto, MessageReactionDto, PeerId, UpdateEvent } from './types';
import type { UploadRequest } from './upload';

/**
 * The comments screen's controller contract, split from `useComments.ts` to
 * keep the hook under the god-file cap.
 */

/**
The comments a caller already read, so the controller does not read them
again: the outcome of the read, whether it worked or not.
*/
export type PrefetchedComments = { ok: true; result: GetCommentsResult } | { ok: false; error: string };

/**
 * A channel post addressed the way the comments bridge does: the channel's id
 * and the post's message id. Shared by the controller and its send half.
 */
export type PostKey = { chatId: PeerId; messageId: number };

export interface CommentsController {
  /**
  The open thread, or null while the comments screen is closed.
  */
  thread: CommentsThread | null;
  loading: boolean;
  loadingOlder: boolean;
  /**
  Comments still on their way to Telegram, in submission order. They render
  beside the loaded comments and never enter the thread's message list.
  */
  pending: readonly PendingMessage[];
  /**
  The last failure of an open or page, as shown by the screen.
  */
  error: string | null;
  /**
  Comment (or pinned post) ids with a reaction request in flight; their chips
  are disabled.
  */
  reactingIds: ReadonlySet<number>;
  /**
  Comment (or pinned post) ids with a vote in flight; their poll's answers are
  disabled.
  */
  votingIds: ReadonlySet<number>;
  /**
  Comment (or pinned post) ids with a callback button press in flight.
  */
  pressingButtonIds: ReadonlySet<number>;
  /**
   * Opens a post's comment thread. A caller that already read the thread —
   * together with the chat's window — hands the outcome over, so the screen
   * does not ask for it a second time.
   */
  open: (chat: ChatDto, message: MessageDto, prefetched?: PrefetchedComments) => Promise<void>;
  close: () => void;
  loadOlder: () => Promise<void>;
  send: (text: string, replyTo?: number) => Promise<void>;
  attach: (request: UploadRequest) => Promise<void>;
  retryPending: (key: string) => void;
  discardPending: (key: string) => void;
  clearPending: () => void;
  react: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  Casts a vote in a poll on the pinned post or a comment, or retracts it with
  `null`.
  */
  vote: (message: MessageDto, options: number[] | null) => void;
  /**
  Presses an inline callback or copy button on the pinned post or a comment.
  */
  pressButton: (message: MessageDto, button: MessageButtonDto) => void;
  /**
  Folds one socket update into the open thread. `App`'s update handler
  forwards every event; updates that are not comments pass through.
  */
  applyUpdate: (update: UpdateEvent) => void;
}
