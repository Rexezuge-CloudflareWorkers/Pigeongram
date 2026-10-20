interface SpinnerProps {
  /**
  Diameter in pixels.
  */
  size?: number;
  /**
  Ring colour; `currentColor` inherits from the surrounding control.
  */
  color?: string;
  /**
  Optional caption under the ring, or beside it in inline mode.
  */
  label?: string;
  /**
  Padding around a page-level spinner; inline spinners default to none.
  */
  padding?: string;
  /**
  Lay the ring out beside its label, for buttons and status lines.
  */
  inline?: boolean;
}

/**
 * The loading ring shared by every busy surface, modelled on the
 * AWS-AccessBridge `Spinner`: a bordered circle with one transparent edge and
 * Tailwind's `animate-spin` rotation.
 *
 * A labelled block spinner is a live status region. An unlabelled or inline
 * one is decorative, because the surrounding control already carries the
 * user-visible text.
 */
export function Spinner({ size = 24, color = 'var(--accent)', label, padding, inline = false }: SpinnerProps) {
  return (
    <span
      className={inline ? 'inline-flex items-center gap-1.5 align-middle' : 'flex flex-col items-center justify-center gap-2.5 text-center'}
      style={{ padding: padding ?? (inline ? '0' : '16px 0') }}
      role={!inline && label !== undefined ? 'status' : undefined}
      aria-hidden={label === undefined ? true : undefined}
    >
      <span
        className="block shrink-0 animate-spin rounded-full border-2 border-solid border-current motion-reduce:animate-none"
        style={{ width: size, height: size, color, borderTopColor: 'transparent' }}
        aria-hidden="true"
      />
      {label === undefined ? null : <span className="text-sm text-muted">{label}</span>}
    </span>
  );
}
