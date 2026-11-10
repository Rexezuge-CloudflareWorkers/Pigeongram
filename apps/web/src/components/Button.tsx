import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The app's buttons, in print shape but built only from the MD3 tokens
 * (tokens.css). Filled is the high-emphasis commit; Text the quiet one;
 * Outlined the boundary one. Tone selects the role: `primary`/`danger`/
 * `accent` for filled, `danger` for text/outlined.
 *
 * These are visual wrappers only: behavior (disabled state, handlers) stays
 * on the native button, exactly as the call sites write it today.
 *
 * Redesign: cut-over point — one accent only for the unpilled commits, text
 * buttons are the escape, outlined names its own boundary. Primary is squared.
 */

type ButtonVariant = 'filled' | 'text' | 'outlined';
type ButtonTone = 'primary' | 'danger' | 'accent';

const SHAPE = 'rounded-xs';
const BASE =
  'inline-flex min-h-10 items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold tracking-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';

const FILLED_TONES: Record<ButtonTone, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary/90 focus-visible:bg-primary/90',
  danger: 'bg-error text-on-error hover:bg-error/90 focus-visible:bg-error/90',
  accent: 'bg-primary text-on-primary hover:bg-primary/90 focus-visible:bg-primary/90',
};

const TEXT_TONES: Record<ButtonTone, string> = {
  primary: 'text-primary hover:bg-primary/10 focus-visible:bg-primary/10',
  danger: 'text-error hover:bg-error/10 focus-visible:bg-error/10',
  accent: 'text-primary hover:bg-primary/10 focus-visible:bg-primary/10',
};

const OUTLINED_TONES: Record<ButtonTone, string> = {
  primary: 'border border-outline text-primary hover:bg-primary/10 focus-visible:bg-primary/10',
  danger: 'border border-error text-error hover:bg-error/10 focus-visible:bg-error/10',
  accent: 'border border-outline text-primary hover:bg-primary/10 focus-visible:bg-primary/10',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  children: ReactNode;
}

export function Button({ variant = 'filled', tone = 'primary', type = 'button', className = '', children, ...rest }: ButtonProps) {
  const toneClasses = variant === 'filled' ? FILLED_TONES[tone] : variant === 'text' ? TEXT_TONES[tone] : OUTLINED_TONES[tone];
  return (
    <button type={type} className={`${BASE} ${SHAPE} ${toneClasses}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}
