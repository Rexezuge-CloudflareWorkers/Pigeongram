import { useEffect, useState } from 'react';
import { Snackbar } from './Snackbar';
import { useExitAnimation } from './useExitAnimation';

interface ToastsProps {
  /**
   The failure that is on screen, if any.
   */
  error: string | null;
  /**
   The notice that is on screen, if any.
   */
  notice: string | null;
}

/**
 * How long a toast stays before the exit animation runs. Notices auto-dismiss;
 * errors stick until replaced so a failure never scrolls away mid-read.
 */
const NOTICE_MS = 4000;

/**
The app's toasts: the failure on top, the notice below it.

Split out of `App.tsx` so the shell stays readable: the app owns the two
messages, this renders them. The exit beat runs through `useExitAnimation`;
the notice dismisses itself after NOTICE_MS (matching the shell's timer),
while the error waits for a replacement. The paint is the MD3 snackbar —
inverse surface in both themes.
*/
export function Toasts({ error, notice }: ToastsProps) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const visibleNotice = notice !== null && notice !== dismissed ? notice : null;
  const noticeExit = useExitAnimation(visibleNotice !== null);
  const errorExit = useExitAnimation(error !== null);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setDismissed(notice), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!errorExit.mounted && !noticeExit.mounted) return null;
  return (
    <div className="toasts">
      {errorExit.mounted ? <Snackbar message={error ?? ''} role="alert" className={errorExit.exiting ? 'is-exiting' : ''} /> : null}
      {noticeExit.mounted ? (
        <Snackbar message={visibleNotice ?? notice ?? ''} role="status" className={noticeExit.exiting ? 'is-exiting' : ''} />
      ) : null}
    </div>
  );
}
