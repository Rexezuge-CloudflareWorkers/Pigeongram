import { Fragment, useEffect, useRef, useState } from 'react';
import { fileUrl } from '../api';
import { formatDay, formatTime, initials, isSameDay } from '../format';
import type { ChatDto, MessageDto } from '../types';

interface ThreadViewProps {
  chat: ChatDto | null;
  messages: MessageDto[];
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  error: string | null;
  onBack: () => void;
  onLoadOlder: () => void;
  onSend: (text: string) => Promise<void>;
}

export function ThreadView({ chat, messages, loading, loadingOlder, sending, error, onBack, onLoadOlder, onSend }: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [draft, setDraft] = useState('');

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

  const submit = (): void => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    void onSend(text).catch(() => setDraft(text));
  };

  return (
    <section className="thread">
      <header className="thread-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back to chat list">
          ←
        </button>
        <span className={`avatar small kind-${chat.kind}`}>{initials(chat.title)}</span>
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
            <MessageRow message={message} chat={chat} />
          </Fragment>
        ))}
      </div>
      {error ? <p className="error pad">{error}</p> : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          rows={1}
          placeholder="Message"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) {
              return;
            }

            event.preventDefault();
            submit();
          }}
        />
        <button type="submit" disabled={sending || draft.trim().length === 0}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </section>
  );
}

function MessageRow({ message, chat }: { message: MessageDto; chat: ChatDto }) {
  const own = message.outgoing;
  const showSender = !own && chat.kind !== 'user' && !message.service;
  return (
    <div className={`message${own ? ' own' : ''}${message.service ? ' service' : ''}`}>
      {showSender && message.senderName ? <span className="sender">{message.senderName}</span> : null}
      {message.photo ? <img className="photo" src={fileUrl(message.chatId, message.id)} alt="Photo" loading="lazy" /> : null}
      {message.text ? <span className="text">{message.text}</span> : null}
      <span className="meta">{formatTime(message.date)}</span>
    </div>
  );
}
