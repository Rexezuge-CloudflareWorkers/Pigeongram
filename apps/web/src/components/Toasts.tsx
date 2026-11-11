import { useEffect, useState } from 'react';
import type { ToastMessage } from '../toast-message';
import { Snackbar } from './Snackbar';
import { useExitAnimation } from './useExitAnimation';
import { useToastCountdown } from './useToastCountdown';

interface ToastsProps {
  /**
   The failure that is on screen, if any.
   */
  error: ToastMessage | null;
  /**
   The notice that is on screen, if any.
   */
  notice: ToastMessage | null;
  /**
   Clears the error after its countdown runs out or its Dismiss action is used.
   */
  onDismissError: () => void;
  /**
   Clears the notice after its countdown runs out.
   */
  onDismissNotice: () => void;
}

/**
 * How long each toast lives. A failure gets a longer read than a notice; both
 * show the same countdown bar, and hovering freezes it until the pointer
 * leaves.
 */
const NOTICE_MS = 4000;
const ERROR_MS = 8000;

/**
 * The exit beat of a toast that was replaced by a newer one. Matches the
 * `toast-out` keyframe in `styles/motion-overlay.css`.
 */
const EXIT_MS = 220;

interface ToastSlotProps {
  toast: ToastMessage | null;
  role: 'alert' | 'status';
  durationMs: number;
  actionLabel?: string;
  onDismiss: () => void;
}

/**
 * One toast kind's slot. A newer arrival preempts what is on screen: the old
 * toast starts its exit beat at once and the new one mounts beside it, so the
 * reader never waits for the previous countdown to end. The old and new share
 * a grid cell while that beat runs, so the stack does not jump.
 */
function ToastSlot({ toast, role, durationMs, actionLabel, onDismiss }: ToastSlotProps) {
  // The message is kept after the slot empties so the exit animation still has
  // text to fade out.
  const [shown, setShown] = useState<ToastMessage | null>(toast);
  const [leaving, setLeaving] = useState<(ToastMessage & { progress: number }) | null>(null);
  const exit = useExitAnimation(toast !== null);
  const timer = useToastCountdown(toast?.token ?? null, durationMs, onDismiss);

  // A new arrival replaces the current toast now. The one that was showing
  // gets its own frozen progress so its bar stops rather than restarting.
  if (toast !== null && toast.token !== shown?.token) {
    if (shown !== null && exit.mounted && !exit.exiting) {
      setLeaving({ ...shown, progress: timer.progress });
    }
    setShown(toast);
  }

  // The preempted toast only needs the length of its exit keyframe.
  useEffect(() => {
    if (leaving === null) return;
    const id = setTimeout(() => {
      setLeaving((current) => (current?.token === leaving.token ? null : current));
    }, EXIT_MS);
    return () => clearTimeout(id);
  }, [leaving]);

  if (!exit.mounted && leaving === null) return null;
  return (
    <div className="toast-stack">
      {leaving === null ? null : (
        <Snackbar key={`leaving-${leaving.token}`} message={leaving.text} role={role} className="is-exiting" progress={leaving.progress} />
      )}
      {exit.mounted ? (
        <Snackbar
          key={shown?.token ?? 'shown'}
          message={shown?.text ?? ''}
          role={role}
          className={exit.exiting ? 'is-exiting' : ''}
          progress={timer.progress}
          onPause={timer.pause}
          onResume={timer.resume}
          actionLabel={actionLabel}
          onAction={actionLabel ? onDismiss : undefined}
        />
      ) : null}
    </div>
  );
}

/**
The app's toasts: the failure on top, the notice below it.

Split out of `App.tsx` so the shell stays readable: the app owns the two
messages, this renders them. Each kind has its own slot, countdown and bar;
a new arrival preempts the one on screen instead of queueing behind it.
A failure stays long enough to read and can be dismissed by hand. The paint is
the MD3 snackbar — inverse surface in both themes.
*/
export function Toasts({ error, notice, onDismissError, onDismissNotice }: ToastsProps) {
  return (
    <div className="toasts">
      <ToastSlot toast={error} role="alert" durationMs={ERROR_MS} actionLabel="Dismiss" onDismiss={onDismissError} />
      <ToastSlot toast={notice} role="status" durationMs={NOTICE_MS} onDismiss={onDismissNotice} />
    </div>
  );
}
