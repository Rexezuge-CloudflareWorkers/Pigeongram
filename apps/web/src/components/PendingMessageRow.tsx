import { useState } from 'react';
import { formatBytes, formatTime } from '../format';
import type { PendingMessage } from '../outbox';
import { pendingAsMessage } from '../outbox';
import type { MessageMediaDto } from '../types';
import { Icon } from './Icon';
import { MessageReplyQuote } from './ReplyQuote';
import { MessageText } from './MessageText';
import { Spinner } from './Spinner';

/**
 * One optimistic message: the bubble the user sees between pressing Send and
 * the bridge confirming the real message. It mirrors the shape of `MessageRow`
 * (reply quote, media, text, a meta line) but reads its media from a local
 * object URL and carries the outbox status instead of Telegram's checks.
 */

interface PendingMessageRowProps {
  entry: PendingMessage;
  onRetry: (key: string) => void;
  onDiscard: (key: string) => void;
}

export function PendingMessageRow({ entry, onRetry, onDiscard }: PendingMessageRowProps) {
  const message = pendingAsMessage(entry);
  return (
    <div className="message own pending">
      {message.reply ? <MessageReplyQuote reply={message.reply} original={entry.replyPreview} /> : null}
      {entry.media ? <PendingMedia entry={entry} media={entry.media} /> : null}
      {entry.text ? (
        <div className="text">
          <MessageText text={entry.text} entities={[]} />
        </div>
      ) : null}
      <span className="meta pending-meta" role="status" aria-live="polite">
        {entry.status === 'failed' ? null : <Spinner inline size={11} color="currentColor" />}
        {statusLabel(entry)}
        {formatTime(entry.createdAt)}
      </span>
      {entry.status === 'failed' ? (
        <div className="pending-actions">
          {entry.failure ? (
            <span className="pending-failure" title={entry.failure}>
              {entry.failure}
            </span>
          ) : null}
          <button type="button" onClick={() => onRetry(entry.key)}>
            Retry
          </button>
          <button type="button" className="discard" onClick={() => onDiscard(entry.key)}>
            Discard
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PendingMedia({ entry, media }: { entry: PendingMessage; media: MessageMediaDto }) {
  const [failed, setFailed] = useState(false);
  const source = entry.previewUrl;

  if (source === null || failed || media.kind === 'document' || media.kind === 'audio' || media.kind === 'voice') {
    return (
      <span className="pending-file">
        <Icon name="attach" size={14} /> {media.fileName ?? 'File'}
        {media.size === null ? '' : ` · ${formatBytes(media.size)}`}
        {entry.fileCount > 1 ? ` · ${String(entry.fileCount)} files` : ''}
      </span>
    );
  }
  const onError = (): void => setFailed(true);
  if (media.kind === 'photo') {
    return <img className="photo" src={source} alt={media.fileName ?? 'Photo'} onError={onError} />;
  }
  if (media.kind === 'video') {
    return <video className="video" src={source} controls preload="metadata" onError={onError} />;
  }
  return <video className="video" src={source} autoPlay loop muted playsInline preload="metadata" onError={onError} />;
}

function statusLabel(entry: PendingMessage): string {
  if (entry.status === 'failed') return 'Not sent · ';
  if (entry.status === 'preparing') return 'Preparing… · ';
  if (entry.status === 'uploading') {
    const progress = entry.progress;
    return progress === null || progress >= 1 ? 'Uploading… · ' : `Uploading ${Math.round(progress * 100)}% · `;
  }
  return 'Sending… · ';
}
