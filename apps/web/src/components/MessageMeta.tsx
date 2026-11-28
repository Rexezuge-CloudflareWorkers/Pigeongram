import { useTranslation } from 'react-i18next';
import { formatCount, formatNumber, formatTime } from '../format';
import type { MessageDto } from '../types';
import { Icon } from './Icon';

/**
The time-and-receipts line under a bubble: the view count of a channel post,
the send time, the "Edited" marker and the account's own read ticks.

Split from `MessageRow.tsx` so the row stays under the god-file cap; it is a
render of the message's metadata alone, so it owns no state.
*/
interface MessageMetaProps {
  message: MessageDto;
  /**
  Whether to draw the account's own read ticks (own messages outside a
  channel).
  */
  showStatus: boolean;
  /**
  Whether the newest read watermark covers this message.
  */
  read: boolean;
}

export function MessageMeta({ message, showStatus, read }: MessageMetaProps) {
  const { t } = useTranslation();
  return (
    <span className="meta">
      {message.views === null ? null : (
        <span className="views" title={t('a11y.views', '{{views}} views', { views: formatNumber(message.views) })}>
          <Icon name="eye" size={12} /> {formatCount(message.views)}
        </span>
      )}
      {formatTime(message.date)}
      {message.editDate === null ? null : (
        <span className="edited" title={t('a11y.editedMessage', 'Edited message')}>
          {t('thread.edited', 'Edited')}
        </span>
      )}
      {showStatus ? (
        <span
          className={`ticks${read ? ' read' : ''}`}
          role="img"
          aria-label={read ? t('thread.sendStatusRead', 'Read') : t('thread.sendStatusSent', 'Sent')}
          title={read ? t('thread.sendStatusRead', 'Read') : t('thread.sendStatusSent', 'Sent')}
        >
          <Icon name={read ? 'done-all' : 'check'} size={14} />
        </span>
      ) : null}
    </span>
  );
}
