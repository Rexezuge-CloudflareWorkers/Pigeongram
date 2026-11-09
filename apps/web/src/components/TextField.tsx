import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

/**
 * The app's text field, in the Material 3 outlined shape: a 56px field with
 * an extra-small corner, `outline` border that becomes the primary colour on
 * focus, and `on-surface` text. Built for the single-line controls the app
 * actually has — search, phone, code, password — so the composer textarea
 * stays its own beast (auto-growing, listbox-driven).
 *
 * The accessible name always comes from the call site (`aria-label` when
 * there is no visible label), which the MD3 label slot does not replace
 * here: the app's chrome uses placeholder + aria-label throughout.
 */

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(({ className = '', ...rest }, ref) => {
  return (
    <input
      ref={ref}
      className={`h-14 w-full rounded-xs border border-outline bg-surface px-4 text-[15px] text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
});
TextField.displayName = 'TextField';
