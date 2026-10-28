import type { CommentsController } from '../comments-controller';
import type { ThreadController } from '../thread-controller';
import { threadReachesLatest } from '../thread-state';
import type { ChatDto, MessageDto, PeerId, PresenceDto } from '../types';
import type { ChatPreview } from '../navigation-types';
import { CommentsView } from './CommentsView';
import { ThreadView } from './ThreadView';

/**
 * The conversation pane: the comments screen when it is open, the chat thread
 * otherwise. Split out of `App.tsx` so the app shell stays readable (and under
 * the god-file cap) while the two views keep their own props.
 */
/**
 * The calls' half of the app shell, as the conversation pane sees it.
 */
interface ThreadPaneCalls {
  startCall: (chatId: number) => void;
  /**
   * Whether a call is already up. The header's call button is disabled then:
   * the controller refuses the second call anyway, but a disabled button says
   * so before the tap.
   */
  callActive: boolean;
}

interface ThreadPaneProps {
  threads: ThreadController;
  comments: CommentsController;
  /**
   * The open chat, or null while no chat is open.
   */
  selected: ChatDto | null;
  /**
   * The open chat's live presence, kept current by the dialogs.
   */
  presence: PresenceDto | null;
  /**
   * Whether the open chat sits in the account's archive.
   */
  archived: boolean;
  /**
   * The open chat as a preview when the account has not joined it; Join takes
   * the composer's place.
   */
  preview: ChatPreview | null;
  /**
   * Joins the open preview chat.
   */
  onJoin: () => void;
  /**
   * Whether the open chat is in the loaded list, so the archive move is
   * meaningful. A chat reached through search is transient.
   */
  canArchive: boolean;
  onBack: () => void;
  /**
   * Moves the open chat into the archive, or back out of it. The promise
   * settles when the move is done.
   */
  onSetArchived: (archived: boolean) => Promise<void>;
  /**
   * The account's calls: the header starts one, and a call in progress
   * disables the button.
   */
  calls: ThreadPaneCalls;
  /**
   * Opens the search overlay scoped to the open chat.
   */
  onSearch: () => void;
  onForward: (messages: readonly MessageDto[]) => void;
  onOpenMedia: (source: 'thread' | 'comments', messageId: number) => void;
  onReadThrough: (chatId: PeerId, maxId: number) => void;
  /**
   * Marks the whole chat read, including an unread backlog the thread has not
   * loaded. The down-arrow jump uses it before reading the newest window.
   */
  onMarkAllRead: (chatId: PeerId) => void;
  onOpenComments: (message: MessageDto) => void;
}

export function ThreadPane({
  threads,
  comments,
  selected,
  presence,
  archived,
  preview,
  onJoin,
  canArchive,
  onBack,
  onSetArchived,
  calls,
  onSearch,
  onForward,
  onOpenMedia,
  onReadThrough,
  onMarkAllRead,
  onOpenComments,
}: ThreadPaneProps) {
  if (comments.thread) {
    return (
      <CommentsView
        thread={comments.thread}
        loading={comments.loading}
        loadingOlder={comments.loadingOlder}
        pending={comments.pending}
        error={comments.error}
        reactingIds={comments.reactingIds}
        votingIds={comments.votingIds}
        pressingButtonIds={comments.pressingButtonIds}
        onBack={onBack}
        onLoadOlder={() => void comments.loadOlder()}
        onSend={comments.send}
        onAttach={comments.attach}
        onRetryPending={comments.retryPending}
        onDiscardPending={comments.discardPending}
        onReact={comments.react}
        onForward={onForward}
        onVote={comments.vote}
        onPressButton={comments.pressButton}
        onOpenMedia={(messageId) => onOpenMedia('comments', messageId)}
      />
    );
  }
  return (
    <ThreadView
      chat={selected}
      presence={presence}
      archived={archived}
      preview={preview === null ? null : { joining: preview.joining, requested: preview.requested }}
      onJoin={onJoin}
      canArchive={canArchive}
      messages={threads.thread?.messages ?? []}
      loading={threads.loading}
      loadingOlder={threads.loadingOlder}
      loadingNewer={threads.loadingNewer}
      hasMoreOlder={threads.thread?.hasMoreOlder ?? false}
      pending={threads.pending}
      error={threads.error}
      botCommands={threads.botCommands}
      description={threads.description}
      reactingIds={threads.reactingIds}
      votingIds={threads.votingIds}
      pressingButtonIds={threads.pressingButtonIds}
      readOutboxMaxId={threads.thread?.readOutboxMaxId ?? 0}
      unreadDividerId={threads.thread?.unreadDividerId ?? null}
      focusMessageId={threads.thread?.focusMessageId ?? null}
      atLatest={threads.thread === null || threadReachesLatest(threads.thread)}
      positions={threads.positions}
      onBack={onBack}
      onSetArchived={onSetArchived}
      onSearch={onSearch}
      onCall={() => {
        if (selected) calls.startCall(selected.id);
      }}
      callActive={calls.callActive}
      onLoadOlder={() => void threads.loadOlder()}
      onLoadNewer={() => void threads.loadNewer()}
      onJumpToLatest={async () => {
        if (!selected) return;
        onMarkAllRead(selected.id);
        await threads.jumpToLatest();
      }}
      onSend={threads.send}
      onAttach={threads.attach}
      onRetryPending={threads.retryPending}
      onDiscardPending={threads.discardPending}
      onReact={threads.react}
      onForward={onForward}
      onVote={threads.vote}
      onPressButton={threads.pressButton}
      onReadThrough={onReadThrough}
      onOpenMedia={(messageId) => onOpenMedia('thread', messageId)}
      onOpenComments={onOpenComments}
    />
  );
}
