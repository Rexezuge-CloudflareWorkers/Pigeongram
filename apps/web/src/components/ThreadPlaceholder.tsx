import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

/**
The reading pane before a chat is picked.

The official desktop clients leave a quiet, branded placeholder instead of a
bare sentence: the send mark in a medallion, then the hint.
*/
export function ThreadPlaceholder() {
  const { t } = useTranslation();
  return (
    <section className="thread empty">
      <span className="thread-empty-mark" aria-hidden="true">
        <Icon name="send" size={44} />
      </span>
      <h2 className="thread-empty-title">{t('thread.noChatSelected', 'No Chat Selected')}</h2>
      <p className="muted thread-empty-hint">{t('thread.noChatSelectedHint', 'Pick A Chat On The Left To Start Reading.')}</p>
    </section>
  );
}
