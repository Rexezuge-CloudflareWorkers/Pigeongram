import { Icon } from './Icon';

/**
 * The app's floating action button: a tonal container with a 40px glyph,
 * elevated by tonal surface pairing rather than a shadow (MD3 level 3).
 * Pairs with `Icon` (`name="arrow-down"` for the scroll-to-latest case).
 */

/**
 * The scroll-to-latest affordance: a small tonal FAB over the message pane.
 * Placement is owned by the caller.
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
      className={`fab-jump inline-flex size-10 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-on-surface shadow-lg transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-50${className ? ` ${className}` : ''}`}
    >
      <Icon name="arrow-down" />
    </button>
  );
}
