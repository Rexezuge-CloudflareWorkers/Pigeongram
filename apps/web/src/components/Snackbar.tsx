import { Button } from './Button';

/**
 * The app's snackbar: the Material 3 notification surface. Dark `inverse-
 * surface` (snackbars keep their contrast against the app's own surface in
 * both themes), extra-small radius, inverse-on-surface message text and a
 * low-emphasis action. It stays in `Toasts`' flow — the shell owns the
 * 4s notice timer and the sticky error; this owns the paint and the
 * exit beat.
 */

export function Snackbar({
  message,
  role,
  actionLabel,
  onAction,
  className = '',
}: {
  message: string;
  role: 'alert' | 'status';
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div
      role={role}
      className={`flex w-full items-center gap-4 rounded-xs bg-inverse-surface px-4 py-3 text-inverse-on-surface shadow-2xl${className ? ` ${className}` : ''}`}
    >
      <p className="min-w-0 flex-1 text-[15px]">{message}</p>
      {actionLabel && onAction ? (
        <Button variant="text" tone="accent" className="min-w-0 shrink-0 px-3" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
