import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDay, isSameDay } from '../format';
import { groupMessages, messageRowSelector } from '../groups';
import { readWatermark } from '../reading';
import { isAtBottom, flashRow, positionThread, readThreadPosition, settleToBottom } from '../thread-position';
import type { ThreadViewProps } from '../thread-view-props';
import type { ChatDto, MessageDto, PeerId } from '../types';
import type { UploadRequest } from '../upload';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { MessageRow } from './MessageRow';
import { PendingMessageRow } from './PendingMessageRow';
import { Spinner } from './Spinner';

/**
 * How long a read watermark is held back before it is reported: scrolling
 * advances it message by message, and every advance is a round trip.
 */
const READ_DEBOUNCE_MS = 250;

export function ThreadView({
  chat,
  presence,
  messages,
  loading,
  loadingOlder,
  pending,
  error,
  botCommands,
  reactingIds,
  votingIds,
  pressingButtonIds,
  readOutboxMaxId,
  onBack,
  onLoadOlder,
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
      stickToBottom.current = isAtBottom(element);
      reportVisible(element);
      return;
    }
    if (!stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
    // A live message pinned to the bottom is on screen; report it read.
    reportVisible(element);
  }, [chat, lastId, lastPendingKey, messages, loading, unreadDividerId, focusMessageId, positions, reportVisible]);

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

  return (
    <section className="thread">
      <header className="thread-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back to chat list">
          ←
        </button>
        <Avatar chatId={chat.id} photo={chat.photo} title={chat.title} kind={chat.kind} small presence={presence} />
        <div className="thread-title">
          <strong>{chat.title}</strong>
          <span className="muted small">
            {chat.kind}
            {chat.username ? ` · @${chat.username}` : ''}
          </span>
        </div>
      </header>
      <div
        className="messages"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current = isAtBottom(element);
          positions.remember(readThreadPosition(element, chat.id));
          reportVisible(element);
        }}
      >
        {messages.length > 0 ? (
          <button type="button" className="load-older" disabled={loadingOlder} aria-busy={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? <Spinner inline size={14} label="Loading…" /> : 'Load older messages'}
          </button>
        ) : null}
        {loading ? <Spinner size={28} label="Loading messages…" padding="24px 0" /> : null}
        {!loading && messages.length === 0 ? <p className="muted pad">No messages yet — say hello.</p> : null}
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
                onReact={onReact}
                voting={votingIds.has(anchor.id)}
                onVote={onVote}
                pressingButton={group.some((message) => pressingButtonIds.has(message.id))}
                onPressButton={onPressButton}
                readOutboxMaxId={readOutboxMaxId}
                onReply={(target) => setReplyingTo({ chatId: chat.id, message: target })}
                onForward={onForward}
                onJump={jumpToMessage}
                onOpenComments={chat.kind === 'channel' ? openComments : undefined}
                onOpenMedia={onOpenMedia}
              />
            </Fragment>
          );
        })}
        {pendingForChat.map((entry, index) => (
          <Fragment key={entry.key}>
            {index === 0 && (lastGroupDate === null || !isSameDay(lastGroupDate, entry.createdAt)) ? (
              <div className="day">{formatDay(entry.createdAt)}</div>
            ) : null}
            <PendingMessageRow entry={entry} onRetry={onRetryPending} onDiscard={onDiscardPending} />
          </Fragment>
        ))}
      </div>
      {error ? <p className="error pad">{error}</p> : null}
      {chat.canSendMessages ? (
        // A per-chat instance keeps a draft and an open command menu from
        // leaking into the next thread.
        <Composer
          key={chat.id}
          placeholder="Message"
          replyTarget={replyTarget}
          botCommands={botCommands}
          onCancelReply={() => setReplyingTo(null)}
          onSend={send}
          onAttach={attach}
        />
      ) : (
        <p className="composer composer-notice">{sendBlockedNotice(chat)}</p>
      )}
    </section>
  );
}

/**
The read-only notice shown in place of the composer: a broadcast channel
explains itself, everything else was restricted by the chat's admins.
*/
function sendBlockedNotice(chat: ChatDto): string {
  return chat.kind === 'channel'
    ? 'Only admins can post in this channel.'
    : 'The admins of this chat have restricted your ability to send messages.';
}
