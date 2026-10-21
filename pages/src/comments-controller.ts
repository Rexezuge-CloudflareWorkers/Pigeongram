import type { CommentsThread } from './state';
import type { ChatDto, MessageButtonDto, MessageDto, MessageReactionDto, UpdateEvent } from './types';
import type { UploadRequest } from './upload';

/**
 * The comments screen's controller contract, split from `useComments.ts` to
 * keep the hook under the god-file cap.
 */
export interface CommentsController {
  /**
  The open thread, or null while the comments screen is closed.
  */
  thread: CommentsThread | null;
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  uploading: boolean;
  uploadProgress: number | null;
  /**
  The last failure of an open, page, send or upload, as shown by the screen.
  */
  error: string | null;
  /**
  Comment ids with a reaction request in flight; their chips are disabled.
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
  open: (chat: ChatDto, message: MessageDto) => Promise<void>;
  close: () => void;
  loadOlder: () => Promise<void>;
  send: (text: string, replyTo?: number) => Promise<void>;
  attach: (request: UploadRequest) => Promise<void>;
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
