import { Icon } from './Icon';

/**
 * The app's floating action button: a tonal container with a 40px glyph,
 * elevated by tonal surface pairing rather than a shadow.
 * Pairs with `Icon` (`name="arrow-down"` for the scroll-to-latest case).
 */

/**
 * The scroll-to-latest affordance, as it sits bottom-centre on the thread:
 * the small tonal FAB over the message pane.
 */
export function JumpToLatestButton({
  onClick,
  disabled = false,
  busy = false,
  className = '',
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      aria-label={busy ? 'Jump In Progress' : 'Jump To Latest And Mark As Read'}
      data-icon-only
      className={`fab-jump absolute bottom-6 left-1/2 z-20 inline-flex size-10 -translate-x-1/2 items-center justify-center rounded-xs border border-outline-variant bg-surface-container-high text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-50${className ? ` ${className}` : ''}`}
    >
      <Icon name="arrow-down" />
    </button>
  );
}
