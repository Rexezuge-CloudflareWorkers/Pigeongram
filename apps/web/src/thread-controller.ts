import type { PendingMessage } from './outbox';
import type { ActiveReplyKeyboard } from './reply-keyboard';
import type { ChatThread } from './thread-state';
import type { ThreadPositionMemory } from './thread-position';
import type { OpenThreadOptions } from './thread-window';
import type {
  BotCommandDto,
  ChatDto,
  DialogDto,
  GetCommentsResult,
  MessageButtonDto,
  MessageDto,
  MessageReactionDto,
  MessageReplyKeyboardButtonDto,
  PeerId,
  UpdateEvent,
} from './types';
import type { UploadRequest } from './upload';
import type { MessageDeletion } from './useMessageDelete';

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
  loadingNewer: boolean;
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
  Whether the open chat is one Telegram no longer offers to this account
  (`not_found`): the view shows the unavailable card instead of an empty thread
  and a composer that could not send.
  */
  unavailable: boolean;
  /**
  The slash-command menu of the open chat, empty for a chat without one. It
  is read together with the thread's window, so the composer has it as soon
  as the thread does.
  */
  botCommands: readonly BotCommandDto[];
  /**
  The text Telegram shows in an empty chat: a bot's description, or a group's
  description. Read with the command menu, and null when the chat has none.
  */
  description: string | null;
  /**
  The chat's active reply keyboard, or null when it shows none. The active one
  is the newest message's markup, which may sit outside the loaded window.
  */
  replyKeyboard: ActiveReplyKeyboard | null;
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
  Opens a chat at the dialog's read watermarks, reading the first window (a
  linked-post window, the unread boundary, or the newest messages), and answers
  with what it read, so a caller chasing that post (its comments) need not look
  it up.
  */
  open: (dialog: DialogDto, options?: OpenThreadOptions) => Promise<OpenThreadResult>;
  close: () => void;
  /**
   * Replaces the open chat's DTO, after a write changed it (a join turns a
   * preview into a chat with a composer) without re-reading its window.
   */
  updateChat: (chat: ChatDto) => void;
  loadOlder: () => Promise<void>;
  /**
  Reads the next page towards the chat's newest message. The view offers it
  only while the loaded range does not reach the newest one, so a large unread
  backlog is read forward instead of being skipped or marked read at once.
  */
  loadNewer: () => Promise<void>;
  /**
   * Fast-forwards the loaded window to the chat's newest messages, so a jump
   * from a backlog or an older linked post can land at the bottom. No-op when
   * the window already reaches the newest message.
   */
  jumpToLatest: () => Promise<void>;
  send: (text: string, replyTo?: number) => Promise<void>;
  /**
  The message this chat is editing, or null while the composer is composing a
  new message. Telegram edits one message at a time, so the view shows a single
  target.
  */
  editing: MessageDto | null;
  /**
  Starts editing a message: the composer pre-fills its text and sends the edit
  instead of a new message. Reply and edit are exclusive, so starting one
  cancels the other.
  */
  startEdit: (message: MessageDto) => void;
  cancelEdit: () => void;
  /**
  Replaces the edited message's text. The composer keeps its draft until
  Telegram answers, so a refused edit loses nothing.
  */
  saveEdit: (text: string) => Promise<void>;
  attach: (request: UploadRequest) => Promise<void>;
  retryPending: (key: string) => void;
  discardPending: (key: string) => void;
  clearPending: () => void;
  react: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  The delete flow: the display group awaiting confirmation, and the actions
  the menu and the confirm dialog call. A delete removes the rows at once and
  puts them back when Telegram refuses it.
  */
  deletion: MessageDeletion;
  /**
  Removes messages from the open window ahead of Telegram's answer. Called by
  the shell's delete flow, which owns the confirmation both screens share.
  */
  removeMessages: (chatId: PeerId, messageIds: readonly number[]) => void;
  /**
  Puts messages a refused delete took out back into the open window.
  */
  restoreMessages: (messages: readonly MessageDto[]) => void;
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
  Presses a reply keyboard button. A text button sends its text; `replyTo`
  carries the composer's reply target so the send matches a typed one. The
  remaining kinds are handled by the view or shown disabled.
  */
  pressReplyKeyboardButton: (button: MessageReplyKeyboardButtonDto, replyTo?: number) => void;
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

/**
What `useThread` needs from its caller. The callbacks name things the caller
owns (the chat list, the toasts, the dropped row), so the hook can stay about
one open thread.
*/
export interface UseThreadOptions {
  /**
  A message the caller sent was accepted: fold it into the dialogs, which
  belong to the caller.
  */
  onSent: (message: MessageDto) => void;
  /**
  A message the caller asked to edit was edited: the returned message is the
  server's copy, so the chat list's preview is repaired from it exactly as a
  live edit from another device would repair it.
  */
  onEdited: (message: MessageDto) => void;
  /**
  Reports a background failure (a reaction that had to roll back) to the
  global toast.
  */
  onError: (error: unknown) => void;
  /**
  Shows an informational message (a bot's callback answer, a clipboard
  confirmation) in the global notice toast.
  */
  onNotice: (text: string) => void;
  /**
  Reports a deletion the open thread folded: what left the window and what it
  still holds, so the chat list can repair its preview and badge. The list
  belongs to the caller, and a deletion in a chat that is not open never
  reaches this hook.
  */
  onDeleted: (chatId: PeerId, removed: readonly MessageDto[], remaining: readonly MessageDto[]) => void;
  /**
  A chat Telegram no longer offers: the chat list drops its row.
  */
  onUnavailable: (chatId: PeerId) => void;
}
