import { Button } from './Button';

/**
 * The app's snackbar: the Material 3 notification surface. Dark `inverse-
 * surface` (snackbars keep their contrast against the app's own surface in
 * both themes), extra-small radius, inverse-on-surface message text and a
 * low-emphasis action. It stays in `Toasts`' flow — that owns the countdown,
 * its bar and the exit beat; this owns the paint, the progress strip and the
 * hover that pauses it.
 */

export function Snackbar({
  message,
  role,
  actionLabel,
  onAction,
  progress,
  onPause,
  onResume,
  className = '',
}: {
  message: string;
  role: 'alert' | 'status';
  actionLabel?: string;
  onAction?: () => void;
  /**
   * The share of the dismiss countdown still left, 1 down to 0. Omitted when
   * the snackbar has no countdown (and no bar).
   */
  progress?: number;
  onPause?: () => void;
  onResume?: () => void;
  className?: string;
}) {
  const filled = progress === undefined ? null : `${Math.max(0, Math.min(1, progress)) * 100}%`;
  return (
    <div
      role={role}
      className={`relative flex w-full items-center gap-4 overflow-hidden rounded-xs bg-inverse-surface px-4 py-3 text-inverse-on-surface shadow-2xl${className ? ` ${className}` : ''}`}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
    >
      <p className="min-w-0 flex-1 text-[15px]">{message}</p>
      {actionLabel && onAction ? (
        <Button variant="text" tone="accent" className="min-w-0 shrink-0 px-3" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
      {filled === null ? null : (
        <span className="toast-progress" aria-hidden="true">
          <span className="toast-progress-bar" style={{ width: filled }} />
        </span>
      )}
    </div>
  );
}
