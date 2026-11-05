import { Icon } from './Icon';

/**
 * The reading pane before a chat is picked.
 *
 * The official desktop clients leave a quiet, branded placeholder instead of a
 * bare sentence: the send mark in a medallion, then the hint.
 */
export function ThreadPlaceholder() {
  return (
    <section className="thread empty">
      <span className="thread-empty-mark" aria-hidden="true">
        <Icon name="send" size={44} />
      </span>
      <h2 className="thread-empty-title">No Chat Selected</h2>
      <p className="muted thread-empty-hint">Pick a conversation on the left to start reading.</p>
    </section>
  );
}
