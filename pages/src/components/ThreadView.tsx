import { Fragment, useEffect, useRef, useState } from 'react';
import { fileUrl } from '../api';
import { formatBytes, formatDay, formatTime, isSameDay } from '../format';
import type { ChatDto, MessageDto, MessageMediaDto } from '../types';
import { Avatar } from './Avatar';

interface ThreadViewProps {
  chat: ChatDto | null;
  messages: MessageDto[];
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  uploading: boolean;
  uploadProgress: number | null;
  error: string | null;
  onBack: () => void;
  onLoadOlder: () => void;
  onSend: (text: string) => Promise<void>;
  onAttach: (file: File, caption: string) => Promise<void>;
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
  onBack,
  onLoadOlder,
  onSend,
  onAttach,
}: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const busy = sending || uploading;

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
    if (!text || busy) return;
    setDraft('');
    void onSend(text).catch(() => setDraft(text));
  };

  const attach = (file: File | undefined): void => {
    if (!file || busy) return;
    // Whatever is in the box rides along as the caption, Telegram-style.
    const caption = draft.trim();
    void onAttach(file, caption)
      .then(() => {
        setDraft((current) => (current === caption ? '' : current));
      })
      .catch(() => {
        // The caption stays in the box so the upload can be retried.
      });
  };

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
        <input
          ref={fileRef}
          type="file"
          className="attach-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            attach(file);
          }}
        />
        <button
          type="button"
          className="attach"
          disabled={busy}
          aria-label="Attach a file"
          title="Attach a file"
          onClick={() => fileRef.current?.click()}
        >
          📎
        </button>
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
        {uploading ? <span className="upload-status">{uploadStatus(uploadProgress)}</span> : null}
        <button type="submit" disabled={busy || draft.trim().length === 0}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </section>
  );
}

function uploadStatus(progress: number | null): string {
  if (progress === null || progress >= 1) return 'Sending…';
  return `Uploading ${Math.round(progress * 100)}%`;
}

function MessageRow({ message, chat }: { message: MessageDto; chat: ChatDto }) {
  const own = message.outgoing;
  const showSender = !own && chat.kind !== 'user' && !message.service;
  return (
    <div className={`message${own ? ' own' : ''}${message.service ? ' service' : ''}`}>
      {showSender && message.senderName ? <span className="sender">{message.senderName}</span> : null}
      {message.media ? <MessageMedia message={message} media={message.media} /> : null}
      {message.text ? <span className="text">{message.text}</span> : null}
      <span className="meta">{formatTime(message.date)}</span>
    </div>
  );
}

function MessageMedia({ message, media }: { message: MessageDto; media: MessageMediaDto }) {
  const src = fileUrl(message.chatId, message.id);
  switch (media.kind) {
    case 'photo': {
      return <img className="photo" src={src} alt={media.fileName ?? 'Photo'} loading="lazy" />;
    }
    case 'video':
    case 'animation': {
      const animation = media.kind === 'animation';
      return (
        <video
          className="video"
          src={src}
          poster={fileUrl(message.chatId, message.id, { thumb: true })}
          controls={!animation}
          autoPlay={animation}
          loop={animation}
          muted={animation}
          playsInline
          preload="metadata"
        />
      );
    }
    case 'audio':
    case 'voice': {
      return <audio className="audio" src={src} controls preload="metadata" />;
    }
    case 'sticker': {
      if (media.mime === 'image/webp') {
        return <img className="sticker" src={src} alt="Sticker" loading="lazy" />;
      }
      return <DocumentLink message={message} />;
    }
    default: {
      return <DocumentLink message={message} />;
    }
  }
}

function DocumentLink({ message }: { message: MessageDto }) {
  const media = message.media;
  return (
    <a
      className="document"
      href={fileUrl(message.chatId, message.id)}
      download={media?.fileName ?? 'download'}
      target="_blank"
      rel="noreferrer"
    >
      <span className="doc-name">{media?.fileName ?? 'File'}</span>
      {media && media.size !== null ? <span className="doc-size">{formatBytes(media.size)}</span> : null}
    </a>
  );
}
