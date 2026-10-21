import type { PendingMessage } from './outbox';
import type { ChatThread } from './state';
import type { ThreadPositionMemory } from './thread-position';
import type { OpenThreadOptions } from './thread-window';
import type {
  BotCommandDto,
  DialogDto,
  GetCommentsResult,
  MessageButtonDto,
  MessageDto,
  MessageReactionDto,
  PeerId,
  UpdateEvent,
} from './types';
import type { UploadRequest } from './upload';

/**
 * The chat thread's controller contract, split from `useThread.ts` to keep the
 * hook under the god-file cap (the same shape as `CommentsController`).
 */

/**
What opening a chat answered.
*/
export interface OpenThreadResult {
  /**
  The window the chat opened with.
  */
  messages: MessageDto[];
  /**
  The post's comment thread, when a post was named. Null when no post was
  named, or when the read failed — the reason is in `commentsError`.
  */
  comments: GetCommentsResult | null;
  /**
  Why the post's comments could not be read, when they could not.
  */
  commentsError: string | null;
}
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
  The slash-command menu of the open chat, empty for a chat without one. It
  is read together with the thread's window, so the composer has it as soon
  as the thread does.
  */
  botCommands: readonly BotCommandDto[];
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
  window around a linked post), and answers with what it read, so a caller
  chasing that post (its comments) need not look it up.
  */
  open: (dialog: DialogDto, options?: OpenThreadOptions) => Promise<OpenThreadResult>;
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
