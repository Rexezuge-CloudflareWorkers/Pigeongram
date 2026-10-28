import type { PendingMessage } from './outbox';
import type { ThreadPositionMemory } from './thread-position';
import type { BotCommandDto, ChatDto, MessageButtonDto, MessageDto, MessageReactionDto, PeerId, PresenceDto } from './types';
import type { UploadRequest } from './upload';

/**
 * The thread screen's props, split from `ThreadView.tsx` to keep that component
 * under the god-file cap. The contract is what `App` forwards from the thread
 * controller plus the view-only unread and focus anchors.
 */
export interface ThreadViewProps {
  chat: ChatDto | null;
  /**
   * The open chat's live presence. It rides beside the chat rather than inside
   * it, so a peer coming online does not replace the chat object the view's
   * effects depend on.
   */
  presence: PresenceDto | null;
  /**
   * Whether the open chat sits in the account's archive. The header offers the
   * move in the direction the chat is not in: an archived chat can be brought
   * back, a chat in the list can be put away.
   */
  archived: boolean;
  /**
   * The open chat as a public preview, when the account has not joined it:
   * Join takes the composer's place, and the message actions that would write
   * (reply, react, vote, press a callback) are not offered. Null for a chat in
   * the account's list.
   */
  preview: { joining: boolean; requested: boolean } | null;
  /**
   * Joins the preview chat, or sends the join request an admin has to approve.
   */
  onJoin: () => void;
  /**
   * Whether the chat is in the loaded list, so the archive move is meaningful.
   * A chat reached through search is transient: it has no folder to move.
   */
  canArchive: boolean;
  /**
   * Opens the search overlay scoped to the open chat.
   */
  onSearch: () => void;
  messages: MessageDto[];
  loading: boolean;
  loadingOlder: boolean;
  loadingNewer: boolean;
  /**
   * Whether a page older than the loaded window may still exist. When false,
   * the top of the thread is the start of the chat's history.
   */
  hasMoreOlder: boolean;
  /**
   * Messages still on their way to Telegram, in submission order. The view
   * filters them to the open chat and renders them after the loaded list.
   */
  pending: readonly PendingMessage[];
  error: string | null;
  /**
   * The slash-command menu of the open chat, empty for a chat without one.
   * It is read together with the thread's window, so the composer offers the
   * menu as soon as the thread is there.
   */
  botCommands: readonly BotCommandDto[];
  /**
   * Message ids with a reaction request in flight; their chips are disabled.
   */
  reactingIds: ReadonlySet<number>;
  /**
   * Message ids with a vote in flight; their polls' answers are disabled.
   */
  votingIds: ReadonlySet<number>;
  /**
   * Message ids with a callback button press in flight.
   */
  pressingButtonIds: ReadonlySet<number>;
  /**
   * Id of the last outgoing message the peer has read. Own messages up to it
   * render a double check; later ones a single sent check.
   */
  readOutboxMaxId: number;
  /**
   * The message the unread divider sits above: the first unread message of the
   * window the chat opened with. Reading advances the watermark but not the
   * line, and the line stays for as long as the chat is open; reopening the
   * chat computes a fresh one. Null when the chat opened fully read.
   */
  unreadDividerId: number | null;
  /**
   * A linked post the chat was opened for: the first window lands on it (and
   * flashes it) instead of on the first unread message; null when the chat was
   * opened normally.
   */
  focusMessageId: number | null;
  /**
   * Whether the loaded range reaches the chat's newest known message. False
   * while an unread backlog or an older linked post leaves messages beyond the
   * window: the view holds the pin back and reads the next newer page as the
   * reader approaches the end, with "Load newer messages" as its fallback.
   */
  atLatest: boolean;
  /**
   * The open thread's remembered place, so returning from the comments screen
   * lands where the reader left instead of at the divider or the bottom.
   */
  positions: ThreadPositionMemory;
  onBack: () => void;
  /**
   * Moves the open chat into the archive, or back out of it. The promise
   * settles when the move is done.
   */
  onSetArchived: (archived: boolean) => Promise<void>;
  /**
   * Starts a voice call to the open chat. The header only offers it for a
   * person, so the callback is never asked to call a group.
   */
  onCall: () => void;
  /**
   * Whether a call is already up. The header's call button is disabled then:
   * the controller refuses the second call anyway, but a disabled button says
   * so before the tap.
   */
  callActive: boolean;
  onLoadOlder: () => void;
  /**
   * Reads the page after the loaded window, towards the chat's newest message.
   */
  onLoadNewer: () => void;
  /**
   * Marks the chat read and reads the newest window, for the down-arrow jump:
   * a backlog or an older linked post is left behind in one action.
   */
  onJumpToLatest: () => Promise<void>;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (request: UploadRequest) => Promise<void>;
  onRetryPending: (key: string) => void;
  onDiscardPending: (key: string) => void;
  onReact: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
   * Starts forwarding a display group; an album forwards every member.
   */
  onForward: (messages: readonly MessageDto[]) => void;
  /**
   * Casts a vote in a poll message, or retracts it with `null`.
   */
  onVote: (message: MessageDto, options: number[] | null) => void;
  /**
   * Presses an inline callback or copy button on a message.
   */
  onPressButton: (message: MessageDto, button: MessageButtonDto) => void;
  onOpenComments: (message: MessageDto) => void;
  /**
   * Opens the full-page viewer at a message's media (an album opens at the
   * clicked member).
   */
  onOpenMedia: (messageId: number) => void;
  /**
   * Reports the highest message id the viewport proves read, for the chat the
   * watermark was measured in (a pending report can outlive a switch).
   */
  onReadThrough: (chatId: PeerId, maxId: number) => void;
}
