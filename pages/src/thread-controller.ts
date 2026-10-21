import type { PendingMessage } from './outbox';
import type { ChatThread } from './state';
import type { ThreadPositionMemory } from './thread-position';
import type { OpenThreadOptions } from './thread-window';
import type { DialogDto, MessageButtonDto, MessageDto, MessageReactionDto, PeerId, UpdateEvent } from './types';
import type { UploadRequest } from './upload';

/**
 * The chat thread's controller contract, split from `useThread.ts` to keep the
 * hook under the god-file cap (the same shape as `CommentsController`).
 */
export interface ThreadController {
  /**
  The open chat and its loaded messages, or null while no chat is open.
  */
  thread: ChatThread | null;
  loading: boolean;
  loadingOlder: boolean;
  /**
  Messages that are still on their way to Telegram, in submission order. They
  render beside the loaded thread and never enter its message list.
  */
  pending: readonly PendingMessage[];
  /**
  The last failure of an open or page, as shown by the thread.
  */
  error: string | null;
  /**
  Message ids with a reaction request in flight; their chips are disabled.
  */
  reactingIds: ReadonlySet<number>;
  /**
  Message ids with a vote in flight; their poll's answers are disabled.
  */
  votingIds: ReadonlySet<number>;
  /**
  Message ids with a callback button press in flight; their callback buttons
  are disabled.
  */
  pressingButtonIds: ReadonlySet<number>;
  /**
  Opens a chat at the dialog's read watermarks, reading the first window (or a
  window around a linked post), and answers with the window it read, so a
  caller chasing that post (its comments) need not look it up.
  */
  open: (dialog: DialogDto, options?: OpenThreadOptions) => Promise<MessageDto[]>;
  close: () => void;
  loadOlder: () => Promise<void>;
  send: (text: string, replyTo?: number) => Promise<void>;
  attach: (request: UploadRequest) => Promise<void>;
  retryPending: (key: string) => void;
  discardPending: (key: string) => void;
  clearPending: () => void;
  react: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  Casts a vote in a poll message: the indexes name the selected answers, or
  `null` retracts the current vote.
  */
  vote: (message: MessageDto, options: number[] | null) => void;
  /**
  Presses an inline callback or copy button on a message.
  */
  pressButton: (message: MessageDto, button: MessageButtonDto) => void;
  /**
  Advances the open thread's read watermark, for a read the view reported or
  the server confirmed.
  */
  setReadWatermark: (chatId: PeerId, maxId: number) => void;
  /**
  Bumps a loaded channel post's comment count after one of the account's own
  comments was accepted by the comments screen.
  */
  bumpCommentCount: (chatId: PeerId, postId: number) => void;
  /**
  The open thread's scroll position; a comments detour resumes it on return.
  */
  positions: ThreadPositionMemory;
  /**
  Folds one socket update into the open thread. `App`'s update handler
  forwards every event; updates that are not the thread pass through.
  */
  applyUpdate: (update: UpdateEvent) => void;
}
