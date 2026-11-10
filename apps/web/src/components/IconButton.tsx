import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The app's icon button: a 40px (MD3 touch target) or 36px (standard) circle
 * with a single glyph. Standard is the quiet `on-surface-variant` glyph
 * over a tonal hover; filled carries `primary` against `on-primary`;
 * tonal sits on `secondary-container`.
 *
 * Pairs with `Icon` for the glyph. The accessible name always comes from the
 * call site (`aria-label`), matching the visible affordance.
 */

type IconButtonVariant = 'standard' | 'filled' | 'tonal';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: 'standard' | 'small';
  children: ReactNode;
}

const VARIANTS: Record<IconButtonVariant, string> = {
  standard: 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  filled: 'bg-primary text-on-primary hover:bg-primary/90',
  tonal: 'bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80',
};

const SIZES = {
  standard: 'size-10',
  small: 'size-9',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'standard', size = 'standard', type = 'button', className = '', children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        data-icon-only
        className={`inline-flex ${SIZES[size]} shrink-0 items-center justify-center rounded-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]}${className ? ` ${className}` : ''}`}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
IconButton.displayName = 'IconButton';
