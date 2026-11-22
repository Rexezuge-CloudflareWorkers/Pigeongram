import type { CommentsController } from '../comments-controller';
import type { ThreadController } from '../thread-controller';
import { threadReachesLatest } from '../thread-state';
import type { ChatDto, MessageDto, PeerId, PresenceDto } from '../types';
import type { ChatPreview } from '../navigation-types';
import { usePinnedMessages } from '../usePinnedMessages';
import { CommentsView } from './CommentsView';
import { DeleteMessagesDialog } from './DeleteMessagesDialog';
import { PinnedMessagesDialog } from './PinnedMessagesDialog';
import { ThreadView } from './ThreadView';

/**
The `newMessageIds` of no thread: the state between chats carries no
arrival bookkeeping, so nothing animates there.
*/
const NO_NEW_MESSAGE_IDS: ReadonlySet<number> = new Set();

/**
The conversation pane: the comments screen when it is open, the chat thread
otherwise. Split out of `App.tsx` so the app shell stays readable (and under
the god-file cap) while the two views keep their own props.
*/
/**
The calls' half of the app shell, as the conversation pane sees it.
*/
interface ThreadPaneCalls {
  startCall: (chatId: number) => void;
  /**
  Whether a call is already up. The header's call button is disabled then:
  the controller refuses the second call anyway, but a disabled button says
  so before the tap.
  */
  callActive: boolean;
}

interface ThreadPaneProps {
  threads: ThreadController;
  comments: CommentsController;
  /**
  The open chat, or null while no chat is open.
  */
  selected: ChatDto | null;
  /**
  The open chat's live presence, kept current by the dialogs.
  */
  presence: PresenceDto | null;
  /**
  Whether the open chat sits in the account's archive.
  */
  archived: boolean;
  /**
  The open chat as a preview when the account has not joined it; Join takes
  the composer's place.
  */
  preview: ChatPreview | null;
  /**
  Joins the open preview chat.
  */
  onJoin: () => void;
  /**
  Whether the open chat is in the loaded list, so the archive move is
  meaningful. A chat reached through search is transient.
  */
  canArchive: boolean;
  onBack: () => void;
  /**
  Moves the open chat into the archive, or back out of it. The promise
  settles when the move is done.
  */
  onSetArchived: (archived: boolean) => Promise<void>;
  /**
  The account's calls: the header starts one, and a call in progress
  disables the button.
  */
  calls: ThreadPaneCalls;
  /**
  Opens the search overlay scoped to the open chat.
  */
  onSearch: () => void;
  onForward: (messages: readonly MessageDto[]) => void;
  onOpenMedia: (source: 'thread' | 'comments', messageId: number) => void;
  onReadThrough: (chatId: PeerId, maxId: number) => void;
  /**
  Marks the whole chat read, including an unread backlog the thread has not
  loaded. The down-arrow jump uses it before reading the newest window.
  */
  onMarkAllRead: (chatId: PeerId) => void;
  onOpenComments: (message: MessageDto) => void;
  /**
  Opens one of the chat's pinned messages at its post, even when it sits
  outside the loaded window. The shell owns the navigation.
  */
  onOpenPost: (messageId: number) => void;
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
  onOpenPost,
}: ThreadPaneProps) {
  // The pinned list is the pane's own overlay: it reads on demand and follows
  // the thread's pin revision, so it is instantiated before either branch.
  const pinned = usePinnedMessages({ chatId: threads.thread?.chat.id ?? null, revision: threads.pinnedRevision });
  if (comments.thread) {
    return (
      <>
        <CommentsView
          thread={comments.thread}
          loading={comments.loading}
          loadingOlder={comments.loadingOlder}
          pending={comments.pending}
          error={comments.error}
          reactingIds={comments.reactingIds}
          votingIds={comments.votingIds}
          pressingButtonIds={comments.pressingButtonIds}
          replyKeyboard={comments.replyKeyboard}
          onBack={onBack}
          onLoadOlder={() => void comments.loadOlder()}
          onSend={comments.send}
          onAttach={comments.attach}
          onRetryPending={comments.retryPending}
          onDiscardPending={comments.discardPending}
          onReact={comments.react}
          onForward={onForward}
          onDelete={comments.deletion.request}
          onVote={comments.vote}
          onPressButton={comments.pressButton}
          onPressReplyKeyboard={comments.pressReplyKeyboardButton}
          onOpenMedia={(messageId) => onOpenMedia('comments', messageId)}
        />
        <DeleteMessagesDialog deletion={comments.deletion} />
      </>
    );
  }
  return (
    <>
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
        newMessageIds={threads.thread?.newMessageIds ?? NO_NEW_MESSAGE_IDS}
        pending={threads.pending}
        error={threads.error}
        unavailable={threads.unavailable}
        botCommands={threads.botCommands}
        description={threads.description}
        replyKeyboard={threads.replyKeyboard}
        reactingIds={threads.reactingIds}
        votingIds={threads.votingIds}
        pressingButtonIds={threads.pressingButtonIds}
        readOutboxMaxId={threads.thread?.readOutboxMaxId ?? 0}
        unreadDividerId={threads.thread?.unreadDividerId ?? null}
        focusMessageId={threads.thread?.focusMessageId ?? null}
        pinnedMessage={threads.thread?.pinnedMessage ?? null}
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
        editing={threads.editing}
        onEdit={threads.startEdit}
        onPin={threads.setPinned}
        onCancelEdit={threads.cancelEdit}
        onSaveEdit={threads.saveEdit}
        onAttach={threads.attach}
        onSendSticker={threads.sendSticker}
        onRetryPending={threads.retryPending}
        onDiscardPending={threads.discardPending}
        onReact={threads.react}
        onForward={onForward}
        onDelete={threads.deletion.request}
        onVote={threads.vote}
        onPressButton={threads.pressButton}
        onPressReplyKeyboard={threads.pressReplyKeyboardButton}
        onReadThrough={onReadThrough}
        onOpenMedia={(messageId) => onOpenMedia('thread', messageId)}
        onOpenComments={onOpenComments}
        onOpenPinned={pinned.openList}
      />
      <DeleteMessagesDialog deletion={threads.deletion} />
      {selected === null ? null : <PinnedMessagesDialog chat={selected} controller={pinned} onOpenPost={onOpenPost} />}
    </>
  );
}
