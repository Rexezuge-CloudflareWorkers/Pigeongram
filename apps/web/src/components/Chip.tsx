import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The app's chip, in the Material 3 filter-chip shape: a 32px rounded
 * `extra-small` pill with an `outline-variant` border when unselected and
 * `secondary-container` (with `on-secondary-container` text) when selected.
 * It keeps `aria-pressed` so the search-scope toggle and other `pressed`
 * affordances keep their contract.
 */

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
}

export function Chip({ selected = false, className = '', children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-xs border px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? 'border-secondary-container bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80'
          : 'border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
      }${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
