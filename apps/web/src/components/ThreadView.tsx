import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDay, isSameDay } from '../format';
import { groupMessages, messageRowSelector } from '../groups';
import { messageWebLink } from '../links';
import { readWatermark } from '../reading';
import { isAtBottom, flashRow, positionThread, readThreadPosition, settleToBottom } from '../thread-position';
import { isNearBottom, isNearTop, usePrependAnchor } from '../thread-paging';
import type { ThreadViewProps } from '../thread-view-props';
import type { MessageDto, PeerId } from '../types';
import type { UploadRequest } from '../upload';
import { JumpToLatest } from './JumpToLatest';
import { MessageRow } from './MessageRow';
import { PendingMessageRow } from './PendingMessageRow';
import { Spinner } from './Spinner';
import { ThreadEmpty } from './ThreadEmpty';
import { ThreadFooter } from './ThreadFooter';
import { ThreadHeader } from './ThreadHeader';

/**
 * How long a read watermark is held back before it is reported: scrolling
 * advances it message by message, and every advance is a round trip.
 */
const READ_DEBOUNCE_MS = 250;

export function ThreadView({
  chat,
  presence,
  archived,
  preview,
  onJoin,
  messages,
  loading,
  loadingOlder,
  loadingNewer,
  hasMoreOlder,
  pending,
  error,
  botCommands,
  description,
  reactingIds,
  votingIds,
  pressingButtonIds,
  readOutboxMaxId,
  onBack,
  onSetArchived,
  canArchive,
  onSearch,
  onCall,
  callActive,
  onLoadOlder,
  onLoadNewer,
  onJumpToLatest,
  onSend,
  onAttach,
  onRetryPending,
  onDiscardPending,
  onReact,
  onForward,
  onVote,
  onPressButton,
  onOpenComments,
  onOpenMedia,
  unreadDividerId,
  focusMessageId,
  atLatest,
  positions,
  onReadThrough,
}: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Position and read bookkeeping lives in refs so scrolling never re-renders.
  const positionedChat = useRef<number | null>(null);
  const positionedFocus = useRef<number | null>(null);
  const readThrough = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRead = useRef<{ chatId: number; maxId: number } | null>(null);
  // The reply target carries its chat id, so switching threads invalidates it
  // without an effect.
  const [replyingTo, setReplyingTo] = useState<{ chatId: number; message: MessageDto } | null>(null);
  // The jump control redraws only when this boolean flips, not on every scroll pixel.
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  // Older pages are prepended above the viewport; keep the row the reader was
  // looking at where it was instead of letting the new content push it down.
  usePrependAnchor(scrollRef, chat === null ? -1 : chat.id, messages[0]?.id ?? null, messages.length);

  // The caller is refreshed every render (the `hooks.ts` pattern), so a read
  // the debounce flushes still reaches it; the chat id captured with the
  // watermark is what keeps a late report pointed at the right dialog.
  const onReadThroughRef = useRef(onReadThrough);
  useEffect(() => {
    onReadThroughRef.current = onReadThrough;
  });

  const flushRead = useCallback((): void => {
    readTimer.current = undefined;
    const pending = pendingRead.current;
    pendingRead.current = null;
    if (pending) onReadThroughRef.current(pending.chatId, pending.maxId);
  }, []);

  const scheduleRead = useCallback(
    (chatId: PeerId, maxId: number): void => {
      if (maxId <= readThrough.current) return;
      readThrough.current = maxId;
      pendingRead.current = { chatId, maxId };
      if (readTimer.current !== undefined) clearTimeout(readTimer.current);
      readTimer.current = setTimeout(flushRead, READ_DEBOUNCE_MS);
    },
    [flushRead],
  );

  // A read still inside the debounce window must not be lost when the view
  // goes away (the comments screen opens, sign-out, tab close).
  useEffect(
    () => () => {
      if (readTimer.current === undefined) {
        return;
      }

      clearTimeout(readTimer.current);
      flushRead();
    },
    [flushRead],
  );

  // Media loading after the first paint and the mobile keyboard both change the
  // list's height. A pinned view follows, so the end stays in view; once the
  // reader has scrolled away it is left alone.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !chat) return;
    return settleToBottom(element, () => stickToBottom.current);
  }, [chat]);

  /**
  Reduces the scroll container's current position to a read watermark: every
  incoming message at least partially in view, or the newest one when pinned
  to the bottom. An already-reported watermark is left alone.
  */
  const reportVisible = useCallback(
    (element: HTMLDivElement): void => {
      const atBottom = isAtBottom(element);
      const visible = new Set<number>();
      if (!atBottom) {
        const container = element.getBoundingClientRect();
        for (const node of element.querySelectorAll<HTMLElement>('[data-message-ids]')) {
          const rect = node.getBoundingClientRect();
          if (rect.top < container.bottom && rect.bottom > container.top) {
            // An album is one element for several messages: a visible bubble
            // proves every member seen.
            for (const id of (node.dataset.messageIds ?? '').split(' ')) {
              if (id) visible.add(Number(id));
            }
          }
        }
      }
      const watermark = readWatermark(messages, visible, atBottom);
      if (watermark !== null && chat) scheduleRead(chat.id, watermark);
    },
    [chat, messages, scheduleRead],
  );

  const lastId = messages.at(-1)?.id ?? 0;
  // Pending sends are filtered by the same stable scope the controller used
  // when it enqueued them; a comments detour can leave another chat's entries
  // in the outbox without leaking them into this thread.
  const threadScope = chat === null ? null : String(chat.id);
  const pendingForChat = threadScope === null ? [] : pending.filter((entry) => entry.scope === threadScope);
  const lastPendingKey = pendingForChat.at(-1)?.key ?? null;
  useLayoutEffect(() => {
    if (!chat) {
      // Closing the thread unmounts the list; the next open — even of the same
      // chat — is a fresh session that must land at its own divider.
      positionedChat.current = null;
      positionedFocus.current = null;
      return;
    }
    // A re-read empties the window before it loads: the scroll position the
    // browser clamps the reused list to belongs to the skeleton, not to the
    // window that is about to land, so the next window positions again.
    if (loading && messages.length === 0) {
      positionedChat.current = null;
      positionedFocus.current = null;
      return;
    }
    const element = scrollRef.current;
    if (!element) return;
    // A jump to a linked post repositions even inside the open chat: the
    // thread was just re-read around that post, so the view follows it.
    const focusChanged = focusMessageId !== null && positionedFocus.current !== focusMessageId;
    if (positionedChat.current !== chat.id || focusChanged) {
      // Wait for the first window: deciding on an empty list would land the
      // position before the messages it belongs to exist.
      if (loading || messages.length === 0) return;
      positionedChat.current = chat.id;
      positionedFocus.current = focusMessageId;
      readThrough.current = 0;
      // The comments screen unmounts this view without closing the thread, so
      // a remembered position wins over the linked post, divider and bottom.
      positionThread(element, {
        focusMessageId,
        unreadDividerId,
        resume: positions.resume(chat.id),
      });
      stickToBottom.current = atLatest && isAtBottom(element);
      setAwayFromBottom(!isAtBottom(element));
      reportVisible(element);
      return;
    }
    if (!stickToBottom.current || !atLatest) return;
    element.scrollTop = element.scrollHeight;
    setAwayFromBottom(false);
    // A live message pinned to the bottom is on screen; report it read.
    reportVisible(element);
  }, [chat, lastId, lastPendingKey, messages, loading, unreadDividerId, focusMessageId, atLatest, positions, reportVisible]);

  if (!chat) {
    return (
      <section className="thread empty">
        <p className="muted">Select a chat to open it.</p>
      </section>
    );
  }

  const replyTarget = replyingTo !== null && replyingTo.chatId === chat.id ? replyingTo.message : null;
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const groups = groupMessages(messages);
  // The day a pending send falls on, when it is not the loaded list's last day.
  const lastGroupDate = groups.at(-1)?.[0]?.date ?? null;

  /**
  Scrolls the thread to a loaded message and flashes it, so a quote click
  reads as a jump rather than a no-op. Unloaded originals stay inert.
  */
  const jumpToMessage = (messageId: number): void => {
    const target = scrollRef.current?.querySelector(messageRowSelector(messageId));
    if (!(target instanceof HTMLElement)) return;
    // An intentional jump unpins immediately; otherwise a settling image
    // could drag the view back to the bottom while the smooth scroll runs.
    stickToBottom.current = false;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashRow(target);
  };

  const send = (text: string, replyTo?: number): Promise<void> => {
    // The outbox carries the reply preview, so the composer is free for the
    // next message before this send is acknowledged.
    setReplyingTo(null);
    return onSend(text, replyTo);
  };
  const attach = (request: UploadRequest): Promise<void> => {
    setReplyingTo(null);
    return onAttach(request);
  };
  const openComments = (message: MessageDto): void => {
    const element = scrollRef.current;
    if (element) positions.remember(readThreadPosition(element, chat.id));
    onOpenComments(message);
  };
  /**
  Catches the reader up: marks the whole chat read and lands at the bottom,
  replacing a window that is behind the newest message.
  */
  const jumpToLatest = async (): Promise<void> => {
    stickToBottom.current = true;
    await onJumpToLatest();
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    setAwayFromBottom(false);
  };

  return (
    <section className="thread">
      <ThreadHeader
        chat={chat}
        presence={presence}
        archived={archived}
        onBack={onBack}
        onSetArchived={onSetArchived}
        canArchive={canArchive}
        onSearch={onSearch}
        onCall={onCall}
        callActive={callActive}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="messages"
          ref={scrollRef}
          onScroll={(event) => {
            // Until this chat's window has landed, the position is the loading
            // skeleton's own: clearing the previous chat clamps the reused list
            // through 0, and remembering that would override the unread divider
            // the open is about to jump to.
            if (positionedChat.current !== chat.id) return;
            const element = event.currentTarget;
            stickToBottom.current = atLatest && isAtBottom(element);
            positions.remember(readThreadPosition(element, chat.id));
            setAwayFromBottom(!isAtBottom(element));
            reportVisible(element);
            // Read the next older page before the reader reaches the top of the
            // loaded window; the controller serializes the requests. A short
            // opening window can already fill the viewport, so the first scroll
            // event at the top is not the reader asking for history.
            if (hasMoreOlder && !loadingOlder && !isAtBottom(element) && isNearTop(element)) onLoadOlder();
            // Forward paging mirrors it: an unread backlog or a linked post can
            // leave the newest messages beyond the window, so approaching its
            // end reads the next newer page too.
            if (!atLatest && !loadingNewer && isNearBottom(element)) onLoadNewer();
          }}
        >
          {messages.length > 0 && (loadingOlder || hasMoreOlder) ? (
            <button type="button" className="load-older" disabled={loadingOlder} aria-busy={loadingOlder} onClick={onLoadOlder}>
              {loadingOlder ? <Spinner inline size={14} label="Loading…" /> : 'Load older messages'}
            </button>
          ) : null}
          {loading ? <Spinner size={28} label="Loading messages…" padding="24px 0" /> : null}
          {!loading && messages.length === 0 ? <ThreadEmpty description={description} preview={preview !== null} /> : null}
          {groups.map((group, index) => {
            const anchor = group[0];
            return (
              <Fragment key={anchor.id}>
                {index === 0 || !isSameDay(groups[index - 1][0].date, anchor.date) ? (
                  <div className="day">{formatDay(anchor.date)}</div>
                ) : null}
                {group.some((message) => message.id === unreadDividerId) ? (
                  <div className="unread-divider" data-unread-divider>
                    Unread Messages
                  </div>
                ) : null}
                <MessageRow
                  group={group}
                  chat={chat}
                  showAvatar={chat.kind === 'group' || chat.kind === 'supergroup'}
                  original={
                    anchor.reply?.origin === 'same_chat' && anchor.reply.messageId !== null
                      ? (messageById.get(anchor.reply.messageId) ?? null)
                      : null
                  }
                  reacting={reactingIds.has(anchor.id)}
                  onReact={preview === null ? onReact : undefined}
                  voting={votingIds.has(anchor.id)}
                  onVote={preview === null ? onVote : undefined}
                  pressingButton={group.some((message) => pressingButtonIds.has(message.id))}
                  onPressButton={preview === null ? onPressButton : undefined}
                  readOutboxMaxId={readOutboxMaxId}
                  onReply={preview === null ? (target) => setReplyingTo({ chatId: chat.id, message: target }) : undefined}
                  onForward={onForward}
                  link={messageWebLink(chat, anchor.id)}
                  onJump={jumpToMessage}
                  onOpenComments={preview === null && chat.kind === 'channel' ? openComments : undefined}
                  onOpenMedia={onOpenMedia}
                />
              </Fragment>
            );
          })}
          {!atLatest && messages.length > 0 ? (
            <button type="button" className="load-newer" disabled={loadingNewer} aria-busy={loadingNewer} onClick={onLoadNewer}>
              {loadingNewer ? <Spinner inline size={14} label="Loading…" /> : 'Load newer messages'}
            </button>
          ) : null}
          {pendingForChat.map((entry, index) => (
            <Fragment key={entry.key}>
              {index === 0 && (lastGroupDate === null || !isSameDay(lastGroupDate, entry.createdAt)) ? (
                <div className="day">{formatDay(entry.createdAt)}</div>
              ) : null}
              <PendingMessageRow entry={entry} onRetry={onRetryPending} onDiscard={onDiscardPending} />
            </Fragment>
          ))}
        </div>
        <JumpToLatest
          visible={!loading && messages.length > 0 && (!atLatest || awayFromBottom)}
          busy={loadingNewer}
          onJump={() => void jumpToLatest()}
        />
      </div>
      {error ? <p className="error pad">{error}</p> : null}
      <ThreadFooter
        chat={chat}
        preview={preview}
        onJoin={onJoin}
        replyTarget={replyTarget}
        botCommands={botCommands}
        onCancelReply={() => setReplyingTo(null)}
        onSend={send}
        onAttach={attach}
      />
    </section>
  );
}
