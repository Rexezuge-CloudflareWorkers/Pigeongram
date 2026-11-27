import { useTranslation } from 'react-i18next';
import { useForwardOriginHandler } from '../telegram-links';
import type { MessageForwardDto } from '../types';
import { Icon } from './Icon';

/**
The "Forwarded from …" line above a bubble's sender.

Only the origin's name is a control: the arrow and the prefix stay text. A
hidden forward has no addressable origin, so its name stays text too.
*/
export function ForwardOrigin({ forward }: { forward: MessageForwardDto }) {
  const { t } = useTranslation();
  const open = useForwardOriginHandler();
  const label = forward.senderName ?? t('thread.hiddenUser', 'A Hidden User');
  const target = forward.senderId ?? forward.fromChatId;
  if (open === null || target === null) {
    return (
      <span className="forward-origin">
        <Icon name="north-east" size={12} className="mr-1" />
        {t('thread.forwardedFrom', 'Forwarded From')} {label}
      </span>
    );
  }
  return (
    <span className="forward-origin">
      <Icon name="north-east" size={12} className="mr-1" />
      {t('thread.forwardedFrom', 'Forwarded From')}{' '}
      <button
        type="button"
        className="forward-origin-link"
        title={t('thread.openLabel', 'Open {{label}}', { label })}
        onClick={(event) => {
          event.stopPropagation();
          open(forward);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {label}
      </button>
    </span>
  );
}
