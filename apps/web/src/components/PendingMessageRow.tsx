import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
One optimistic message: the bubble the user sees between pressing Send and
the bridge confirming the real message. It mirrors the shape of `MessageRow`
(reply quote, media, text, a meta line) but reads its media from a local
object URL and carries the outbox status instead of Telegram's checks.
*/

interface PendingMessageRowProps {
  entry: PendingMessage;
  onRetry: (key: string) => void;
  onDiscard: (key: string) => void;
}

export function PendingMessageRow({ entry, onRetry, onDiscard }: PendingMessageRowProps) {
  const { t } = useTranslation();
  const message = pendingAsMessage(entry);
  // A plain single-file send renders without the bubble; its outbox status and
  // time float on hover/focus. A caption, reply, album count, or a failed send
  // (which must keep Retry/Discard reachable) stays bubbled.
  const bare =
    entry.media !== null &&
    entry.media.kind !== 'voice' &&
    entry.text.length === 0 &&
    message.reply === null &&
    entry.fileCount <= 1 &&
    entry.status !== 'failed';
  const meta = (
    <span className="meta pending-meta" role="status" aria-live="polite">
      {entry.status === 'failed' ? null : <Spinner inline size={11} color="currentColor" />}
      {statusLabel(t, entry)}
      {formatTime(entry.createdAt)}
    </span>
  );
  return (
    <div className={`message own pending${bare ? ' bare' : ''}`}>
      {message.reply ? <MessageReplyQuote reply={message.reply} original={entry.replyPreview} /> : null}
      {entry.media ? <PendingMedia entry={entry} media={entry.media} t={t} /> : null}
      {entry.text ? (
        <div className="text">
          <MessageText text={entry.text} entities={[]} />
        </div>
      ) : null}
      {meta}
      {entry.status === 'uploading' && entry.progress !== null ? (
        <span className="pending-progress" aria-hidden="true">
          <span className="pending-progress-bar" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
        </span>
      ) : null}
      {entry.status === 'failed' ? (
        <div className="pending-actions">
          {entry.failure ? (
            <span className="pending-failure" title={entry.failure}>
              {entry.failure}
            </span>
          ) : null}
          <button type="button" onClick={() => onRetry(entry.key)}>
            {t('messages.retry', 'Retry')}
          </button>
          <button type="button" className="discard" onClick={() => onDiscard(entry.key)}>
            {t('messages.discard', 'Discard')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PendingMedia({ entry, media, t }: { entry: PendingMessage; media: MessageMediaDto; t: TFunction }) {
  const [failed, setFailed] = useState(false);
  const source = entry.previewUrl;

  if (source === null || failed) {
    return (
      <span className="pending-file">
        <Icon name="attach" size={14} /> {media.fileName ?? t('media.file', 'File')}
        {media.size === null ? '' : ` · ${formatBytes(media.size)}`}
        {entry.fileCount > 1 ? ` · ${t('messages.fileCount', '{{count, number}} Files', { count: entry.fileCount })}` : ''}
      </span>
    );
  }
  const onError = (): void => setFailed(true);
  if (media.kind === 'voice') {
    // The local blob plays while it uploads, exactly as the settled message
    // will: a voice note the reader cannot hear is not a voice note.
    return <audio className="audio" src={source} controls preload="metadata" onError={onError} />;
  }
  if (media.kind === 'document' || media.kind === 'audio') {
    return (
      <span className="pending-file">
        <Icon name="attach" size={14} /> {media.fileName ?? t('media.file', 'File')}
        {media.size === null ? '' : ` · ${formatBytes(media.size)}`}
        {entry.fileCount > 1 ? ` · ${t('messages.fileCount', '{{count, number}} Files', { count: entry.fileCount })}` : ''}
      </span>
    );
  }
  if (media.kind === 'photo') {
    return <img className="photo" src={source} alt={media.fileName ?? t('a11y.photoAlt', 'Photo')} onError={onError} />;
  }
  if (media.kind === 'sticker') {
    return <img className="sticker" src={source} alt={t('media.stickerAlt', 'Sticker')} onError={onError} />;
  }
  if (media.kind === 'video') {
    return <video className="video" src={source} controls preload="metadata" onError={onError} />;
  }
  return <video className="video" src={source} autoPlay loop muted playsInline preload="metadata" onError={onError} />;
}

function statusLabel(t: TFunction, entry: PendingMessage): string {
  if (entry.status === 'failed') return t('messages.notSentLabel', 'Not Sent · ');
  if (entry.status === 'preparing') return t('messages.preparingLabel', 'Preparing… · ');
  if (entry.status === 'uploading') {
    const progress = entry.progress;
    return progress === null || progress >= 1
      ? t('messages.uploadingLabel', 'Uploading… · ')
      : t('messages.uploadingPercentLabel', 'Uploading {{percent}}% · ', { percent: Math.round(progress * 100) });
  }
  return t('messages.sendingLabel', 'Sending… · ');
}
