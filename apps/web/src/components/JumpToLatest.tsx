import { Icon } from './Icon';

/**
 * The floating control that catches a reader up: scroll to the newest message
 * and mark the chat read. It sits at the bottom edge of the thread's scroll
 * area, so it stays reachable while the reader is anywhere in the history.
 *
 * The view owns when it is offered (scrolled away or behind a backlog) and what
 * the jump does; this component only paints the control.
 */

interface JumpToLatestProps {
  /**
   * Whether there is somewhere to jump: the loaded window is behind the newest
   * message, or the reader has left the bottom.
   */
  visible: boolean;
  /**
   * A newer page is already on its way; a second jump would only queue behind
   * it.
   */
  busy: boolean;
  onJump: () => void;
}

export function JumpToLatest({ visible, busy, onJump }: JumpToLatestProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      className="absolute right-3 bottom-3 z-10 inline-flex size-10 items-center justify-center rounded-full border border-line bg-panel-2 text-muted shadow-lg transition-colors hover:bg-line hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50"
      aria-label="Jump to latest and mark as read"
      title="Jump to latest and mark as read"
      aria-busy={busy}
      disabled={busy}
      onClick={onJump}
    >
      <Icon name="arrow-down" />
    </button>
  );
}
