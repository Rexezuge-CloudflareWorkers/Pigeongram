import type { InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

/**
 * The app's checkbox, in the Material 3 shape: a 20px box, rounded extra-
 * small, with an `outline` border that fills with `primary` (and an
 * `on-primary` check) when checked. The accessible name comes from the
 * call site, so it sits inside the `<label>` it belongs to (UploadDialog's
 * "Group Items") exactly like the native control it replaces.
 */

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  className?: string;
}

export function Checkbox({ checked, disabled, className = '', ...rest }: CheckboxProps) {
  return (
    <span
      className={`relative inline-flex size-5 shrink-0 items-center justify-center rounded-xs border ${checked ? 'border-primary bg-primary text-on-primary' : 'border-outline text-transparent'} disabled:cursor-not-allowed disabled:opacity-40${className ? ` ${className}` : ''}`}
    >
      <Icon name="check" size={16} />
      <input
        type="checkbox"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        checked={checked}
        disabled={disabled}
        {...rest}
      />
    </span>
  );
}
