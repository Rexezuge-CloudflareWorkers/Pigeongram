import { JumpToLatestButton } from './Fab';

/**
 * The floating control that catches a reader up: scroll to the newest message
 * and mark the chat read. It sits at the bottom edge of the thread's scroll
 * area, so it stays reachable while the reader is anywhere in the history.
 *
 * The view owns when it is offered (scrolled away or behind a backlog) and what
 * the jump does; this component only paints the control. The control itself is
 * the app's jump-to-latest button: a small tonal FAB, MD3 in shape, keeping
 * its thread position (right edge, not the Fab's centre alignment).
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
    <span className="absolute right-3 bottom-3 z-10" title="Jump To Latest And Mark As Read">
      <JumpToLatestButton onClick={onJump} disabled={busy} busy={busy} />
    </span>
  );
}
