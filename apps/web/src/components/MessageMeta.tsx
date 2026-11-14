import { formatCount, formatTime } from '../format';
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
  return (
    <span className="meta">
      {message.views === null ? null : (
        <span className="views" title={`${message.views.toLocaleString()} views`}>
          <Icon name="eye" size={12} /> {formatCount(message.views)}
        </span>
      )}
      {formatTime(message.date)}
      {message.editDate === null ? null : (
        <span className="edited" title="Edited message">
          Edited
        </span>
      )}
      {showStatus ? (
        <span className={`ticks${read ? ' read' : ''}`} role="img" aria-label={read ? 'Read' : 'Sent'} title={read ? 'Read' : 'Sent'}>
          <Icon name={read ? 'done-all' : 'check'} size={14} />
        </span>
      ) : null}
    </span>
  );
}
