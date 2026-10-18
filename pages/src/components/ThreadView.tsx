import { Fragment, useEffect, useRef, useState } from 'react';
import { formatDay, isSameDay } from '../format';
import type { ChatDto, MessageDto, MessageReactionDto } from '../types';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { MessageRow } from './MessageRow';

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
  onBack: () => void;
  onLoadOlder: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (file: File, caption: string, replyTo?: number) => Promise<void>;
  onReact: (message: MessageDto, reaction: MessageReactionDto) => void;
  onOpenComments: (message: MessageDto) => void;
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
  onBack,
  onLoadOlder,
  onSend,
  onAttach,
  onReact,
  onOpenComments,
}: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // The reply target carries its chat id, so switching threads invalidates it
  // without an effect.
  const [replyingTo, setReplyingTo] = useState<{ chatId: number; message: MessageDto } | null>(null);

  const lastId = messages.at(-1)?.id ?? 0;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lastId, chat?.id, messages.length]);

  if (!chat) {
    return (
      <section className="thread empty">
        <p className="muted">Select a chat to open it.</p>
      </section>
    );
  }

  const replyTarget = replyingTo !== null && replyingTo.chatId === chat.id ? replyingTo.message : null;
  const messageById = new Map(messages.map((message) => [message.id, message]));

  /**
  Scrolls the thread to a loaded message and flashes it, so a quote click
  reads as a jump rather than a no-op. Unloaded originals stay inert.
  */
  const jumpToMessage = (messageId: number): void => {
    const target = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
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
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        {messages.length > 0 ? (
          <button type="button" className="load-older" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        ) : null}
        {loading ? <p className="muted pad">Loading messages…</p> : null}
        {!loading && messages.length === 0 ? <p className="muted pad">No messages yet — say hello.</p> : null}
        {messages.map((message, index) => (
          <Fragment key={message.id}>
            {index === 0 || !isSameDay(messages[index - 1].date, message.date) ? (
              <div className="day">{formatDay(message.date)}</div>
            ) : null}
            <MessageRow
              message={message}
              chat={chat}
              original={
                message.reply?.origin === 'same_chat' && message.reply.messageId !== null
                  ? (messageById.get(message.reply.messageId) ?? null)
                  : null
              }
              reacting={reactingIds.has(message.id)}
              onReact={onReact}
              onReply={(target) => setReplyingTo({ chatId: chat.id, message: target })}
              onJump={jumpToMessage}
              onOpenComments={chat.kind === 'channel' ? onOpenComments : undefined}
            />
          </Fragment>
        ))}
      </div>
      {error ? <p className="error pad">{error}</p> : null}
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
    </section>
  );
}
