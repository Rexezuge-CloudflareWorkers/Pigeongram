import { fileUrl } from '../api';
import { formatBytes, formatTime } from '../format';
import { renderMessageText } from '../richtext';
import { reactionKey } from '../state';
import type { ChatDto, MessageCommentsDto, MessageDto, MessageMediaDto, MessageReactionDto } from '../types';
import { MessageReplyQuote } from './ReplyQuote';

/**
One message bubble: reply quote, media, rich text, reaction chips, comments
button and timestamp. Shared by the thread and the comments view; the optional
handlers decide which affordances a given view offers (the comments view's post
header, for example, is inert).
*/

export interface MessageRowProps {
  message: MessageDto;
  chat: ChatDto;
  /**
  The loaded message this one replies to, when it is still in the thread.
  */
  original: MessageDto | null;
  /**
  Whether the reply quote renders (default true); the comments view hides it
  for headers that point at the thread's root, which Telegram shows bare.
  */
  showQuote?: boolean;
  /**
  Whether this message has a reaction request in flight; its chips are
  disabled.
  */
  reacting?: boolean;
  onReact?: (message: MessageDto, reaction: MessageReactionDto) => void;
  onReply?: (message: MessageDto) => void;
  onJump?: (messageId: number) => void;
  /**
  Opens the message's comments thread; only rendered when the caller decides
  the chat offers comments.
  */
  onOpenComments?: (message: MessageDto) => void;
}

export function MessageRow({
  message,
  chat,
  original,
  showQuote = true,
  reacting = false,
  onReact,
  onReply,
  onJump,
  onOpenComments,
}: MessageRowProps) {
  const own = message.outgoing;
  const showSender = !own && chat.kind !== 'user' && !message.service;
  const comments = message.comments;
  return (
    <div
      className={`message${own ? ' own' : ''}${message.service ? ' service' : ''}`}
      data-message-id={message.id}
      onDoubleClick={() => {
        if (!message.service && onReply) onReply(message);
      }}
    >
      {onReply && !message.service ? (
        <button type="button" className="reply-button" aria-label="Reply" title="Reply" onClick={() => onReply(message)}>
          ↩
        </button>
      ) : null}
      {showSender && message.senderName ? <span className="sender">{message.senderName}</span> : null}
      {showQuote && message.reply ? <MessageReplyQuote reply={message.reply} original={original} onJump={onJump} /> : null}
      {message.media ? <MessageMedia message={message} media={message.media} /> : null}
      {message.text ? <div className="text">{renderMessageText(message.text, message.entities)}</div> : null}
      {message.reactions.length > 0 ? (
        <div className="reactions">
          {message.reactions.map((reaction) => {
            const title = reaction.emoji ?? 'Custom emoji';
            const emoji = <span className="reaction-emoji">{reaction.emoji ?? '◻'}</span>;
            const count = <span className="reaction-count">{reaction.count}</span>;
            if (!onReact) {
              return (
                <span key={reactionKey(reaction)} className={`reaction static${reaction.chosen ? ' chosen' : ''}`} title={title}>
                  {emoji}
                  {count}
                </span>
              );
            }
            return (
              <button
                key={reactionKey(reaction)}
                type="button"
                className={`reaction${reaction.chosen ? ' chosen' : ''}`}
                disabled={reacting}
                title={title}
                aria-label={`React ${title} (${String(reaction.count)})`}
                aria-pressed={reaction.chosen}
                onClick={() => onReact(message, reaction)}
              >
                {emoji}
                {count}
              </button>
            );
          })}
        </div>
      ) : null}
      {onOpenComments && comments && (comments.hasComments || comments.count > 0) ? (
        <button type="button" className="comments-button" onClick={() => onOpenComments(message)}>
          💬 {commentLabel(comments)}
        </button>
      ) : null}
      <span className="meta">{formatTime(message.date)}</span>
    </div>
  );
}

function commentLabel(comments: MessageCommentsDto): string {
  if (comments.count === 0) return 'Leave a comment';
  return comments.count === 1 ? '1 comment' : `${comments.count} comments`;
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
