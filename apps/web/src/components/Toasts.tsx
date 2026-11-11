import { useState } from 'react';
import { Snackbar } from './Snackbar';
import { useExitAnimation } from './useExitAnimation';
import { useToastCountdown } from './useToastCountdown';

interface ToastsProps {
  /**
   The failure that is on screen, if any.
   */
  error: string | null;
  /**
   The notice that is on screen, if any.
   */
  notice: string | null;
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
The app's toasts: the failure on top, the notice below it.

Split out of `App.tsx` so the shell stays readable: the app owns the two
messages, this renders them. The exit beat runs through `useExitAnimation`;
the countdown (and its bar) runs through `useToastCountdown`, which also owns
the hover pause. A failure stays long enough to read and can be dismissed by
hand. The paint is the MD3 snackbar — inverse surface in both themes.
*/
export function Toasts({ error, notice, onDismissError, onDismissNotice }: ToastsProps) {
  // The message is kept after the slot empties so the exit animation still has
  // text to fade out; the countdown restarts when it changes.
  const [lastError, setLastError] = useState<string | null>(error);
  const [lastNotice, setLastNotice] = useState<string | null>(notice);
  if (error !== null && error !== lastError) setLastError(error);
  if (notice !== null && notice !== lastNotice) setLastNotice(notice);

  const errorExit = useExitAnimation(error !== null);
  const noticeExit = useExitAnimation(notice !== null);
  const errorTimer = useToastCountdown(error, ERROR_MS, onDismissError);
  const noticeTimer = useToastCountdown(notice, NOTICE_MS, onDismissNotice);

  if (!errorExit.mounted && !noticeExit.mounted) return null;
  return (
    <div className="toasts">
      {errorExit.mounted ? (
        <Snackbar
          message={error ?? lastError ?? ''}
          role="alert"
          className={errorExit.exiting ? 'is-exiting' : ''}
          progress={errorTimer.progress}
          onPause={errorTimer.pause}
          onResume={errorTimer.resume}
          actionLabel="Dismiss"
          onAction={onDismissError}
        />
      ) : null}
      {noticeExit.mounted ? (
        <Snackbar
          message={notice ?? lastNotice ?? ''}
          role="status"
          className={noticeExit.exiting ? 'is-exiting' : ''}
          progress={noticeTimer.progress}
          onPause={noticeTimer.pause}
          onResume={noticeTimer.resume}
        />
      ) : null}
    </div>
  );
}
