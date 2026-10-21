import type { CommentsController } from '../comments-controller';
import type { ThreadController } from '../thread-controller';
import type { ChatDto, MessageDto, PeerId, PresenceDto } from '../types';
import { CommentsView } from './CommentsView';
import { ThreadView } from './ThreadView';

/**
 * The conversation pane: the comments screen when it is open, the chat thread
 * otherwise. Split out of `App.tsx` so the app shell stays readable (and under
 * the god-file cap) while the two views keep their own props.
 */
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
   * Whether the chat's archive move is in flight.
   */
  archiving: boolean;
  onBack: () => void;
  /**
   * Moves the open chat into the archive, or back out of it.
   */
  onSetArchived: (archived: boolean) => void;
  onForward: (messages: readonly MessageDto[]) => void;
  onOpenMedia: (source: 'thread' | 'comments', messageId: number) => void;
  onReadThrough: (chatId: PeerId, maxId: number) => void;
  onOpenComments: (message: MessageDto) => void;
}

export function ThreadPane({
  threads,
  comments,
  selected,
  presence,
  archived,
  archiving,
  onBack,
  onSetArchived,
  onForward,
  onOpenMedia,
  onReadThrough,
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
      archiving={archiving}
      messages={threads.thread?.messages ?? []}
      loading={threads.loading}
      loadingOlder={threads.loadingOlder}
      pending={threads.pending}
      error={threads.error}
      botCommands={threads.botCommands}
      reactingIds={threads.reactingIds}
      votingIds={threads.votingIds}
      pressingButtonIds={threads.pressingButtonIds}
      readOutboxMaxId={threads.thread?.readOutboxMaxId ?? 0}
      unreadDividerId={threads.thread?.unreadDividerId ?? null}
      focusMessageId={threads.thread?.focusMessageId ?? null}
      positions={threads.positions}
      onBack={onBack}
      onSetArchived={onSetArchived}
      onLoadOlder={() => void threads.loadOlder()}
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
