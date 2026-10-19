import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDay, isSameDay } from '../format';
import { groupMessages, messageRowSelector } from '../groups';
import { firstUnread, readWatermark } from '../reading';
import type { ChatDto, MessageDto, MessageReactionDto, PeerId } from '../types';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { MessageRow } from './MessageRow';

/**
 * The list counts as "at the bottom" within this many pixels, for both the
 * stick-to-bottom pin and the read watermark.
 */
const BOTTOM_PX = 80;

/**
 * How long a read watermark is held back before it is reported: scrolling
 * advances it message by message, and every advance is a round trip.
 */
const READ_DEBOUNCE_MS = 250;

interface ThreadViewProps {
  chat: ChatDto | null;
  messages: MessageDto[];
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  uploading: boolean;
  uploadProgress: number | null;
  error: string | null;
  /**
  Message ids with a reaction request in flight; their chips are disabled.
  */
  reactingIds: ReadonlySet<number>;
  /**
  Message ids with a vote in flight; their polls' answers are disabled.
  */
  votingIds: ReadonlySet<number>;
  /**
  The chat's read watermark: the thread opens at the first unread message
  after it, and reading advances it.
  */
  readInboxMaxId: number;
  onBack: () => void;
  onLoadOlder: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (file: File, caption: string, replyTo?: number) => Promise<void>;
  onReact: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  Casts a vote in a poll message, or retracts it with `null`.
  */
  onVote: (message: MessageDto, options: number[] | null) => void;
  onOpenComments: (message: MessageDto) => void;
  /**
  Reports the highest message id the viewport proves read, for the chat the
  watermark was measured in (a pending report can outlive a switch).
  */
  onReadThrough: (chatId: PeerId, maxId: number) => void;
}

export function ThreadView({
  chat,
  messages,
  loading,
  loadingOlder,
  sending,
  uploading,
  uploadProgress,
  error,
  reactingIds,
  votingIds,
  onBack,
  onLoadOlder,
  onSend,
  onAttach,
  onReact,
  onVote,
  onOpenComments,
  readInboxMaxId,
  onReadThrough,
}: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Position and read bookkeeping lives in refs so scrolling never re-renders.
  const positionedChat = useRef<number | null>(null);
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

  /**
  Reduces the scroll container's current position to a read watermark: every
  incoming message at least partially in view, or the newest one when pinned
  to the bottom. An already-reported watermark is left alone.
  */
  const reportVisible = useCallback(
    (element: HTMLDivElement): void => {
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_PX;
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
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !chat) return;
    if (positionedChat.current !== chat.id) {
      // Wait for the first window: deciding on an empty list would land the
      // position before the messages it belongs to exist.
      if (loading || messages.length === 0) return;
      positionedChat.current = chat.id;
      readThrough.current = 0;
      const anchor = firstUnread(messages, readInboxMaxId);
      if (anchor) {
        const divider = element.querySelector<HTMLElement>('[data-unread-divider]');
        const target = divider ?? element.querySelector<HTMLElement>(messageRowSelector(anchor.id));
        target?.scrollIntoView({ block: 'start' });
      } else {
        element.scrollTop = element.scrollHeight;
      }
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_PX;
      reportVisible(element);
      return;
    }
    if (!stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
    // A live message pinned to the bottom is on screen; report it read.
    reportVisible(element);
  }, [chat, lastId, messages, loading, readInboxMaxId, reportVisible]);

  if (!chat) {
    return (
      <section className="thread empty">
        <p className="muted">Select a chat to open it.</p>
      </section>
    );
  }

  const replyTarget = replyingTo !== null && replyingTo.chatId === chat.id ? replyingTo.message : null;
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const unreadAnchorId = firstUnread(messages, readInboxMaxId)?.id ?? null;
  const groups = groupMessages(messages);

  /**
  Scrolls the thread to a loaded message and flashes it, so a quote click
  reads as a jump rather than a no-op. Unloaded originals stay inert.
  */
  const jumpToMessage = (messageId: number): void => {
    const target = scrollRef.current?.querySelector(messageRowSelector(messageId));
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('reply-flash');
    setTimeout(() => target.classList.remove('reply-flash'), 1200);
  };

  const send = (text: string, replyTo?: number): Promise<void> => onSend(text, replyTo).then(() => setReplyingTo(null));
  const attach = (file: File, caption: string, replyTo?: number): Promise<void> =>
    onAttach(file, caption, replyTo).then(() => setReplyingTo(null));

  return (
    <section className="thread">
      <header className="thread-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back to chat list">
          ←
        </button>
        <Avatar chatId={chat.id} photo={chat.photo} title={chat.title} kind={chat.kind} small />
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
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_PX;
          reportVisible(element);
        }}
      >
        {messages.length > 0 ? (
          <button type="button" className="load-older" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        ) : null}
        {loading ? <p className="muted pad">Loading messages…</p> : null}
        {!loading && messages.length === 0 ? <p className="muted pad">No messages yet — say hello.</p> : null}
        {groups.map((group, index) => {
          const anchor = group[0];
          return (
            <Fragment key={anchor.id}>
              {index === 0 || !isSameDay(groups[index - 1][0].date, anchor.date) ? (
                <div className="day">{formatDay(anchor.date)}</div>
              ) : null}
              {group.some((message) => message.id === unreadAnchorId) ? (
                <div className="unread-divider" data-unread-divider>
                  Unread messages
                </div>
              ) : null}
              <MessageRow
                group={group}
                chat={chat}
                original={
                  anchor.reply?.origin === 'same_chat' && anchor.reply.messageId !== null
                    ? (messageById.get(anchor.reply.messageId) ?? null)
                    : null
                }
                reacting={reactingIds.has(anchor.id)}
                onReact={onReact}
                voting={votingIds.has(anchor.id)}
                onVote={onVote}
                onReply={(target) => setReplyingTo({ chatId: chat.id, message: target })}
                onJump={jumpToMessage}
                onOpenComments={chat.kind === 'channel' ? onOpenComments : undefined}
              />
            </Fragment>
          );
        })}
      </div>
      {error ? <p className="error pad">{error}</p> : null}
      {chat.canSendMessages ? (
        <Composer
          placeholder="Message"
          sending={sending}
          uploading={uploading}
          uploadProgress={uploadProgress}
          replyTarget={replyTarget}
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
