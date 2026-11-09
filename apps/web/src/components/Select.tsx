import type { SelectHTMLAttributes } from 'react';
import { Icon } from './Icon';

/**
 * The app's select, in the Material 3 outlined shape: the same 56px
 * extra-small field as `TextField`, with the platform's own options — the
 * native menu is what makes the video-quality picker reliable on every
 * browser, so no headless dropdown replaces it. The accessible name is the
 * call site's `aria-label` (e.g. "Video quality").
 *
 * Font size is 16px (`text-base`) to prevent iOS Safari input zoom; the
 * video-quality select lives in the viewer chrome, so it is kept at 16px
 * even though the text is small.
 */

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
  children: React.ReactNode;
}

export function Select({ className = '', children, ...rest }: SelectProps) {
  return (
    <span className={`relative inline-flex w-full items-center${className ? ` ${className}` : ''}`}>
      <select
        className="h-14 w-full appearance-none rounded-xs border border-outline bg-surface px-4 pr-10 text-base text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        {...rest}
      >
        {children}
      </select>
      <Icon name="arrow-down" className="pointer-events-none absolute right-3 text-on-surface-variant" aria-hidden="true" />
    </span>
  );
}
