import { useCallback, useRef, useState } from 'react';
import type { ToastMessage } from '../toast-message';

/**
 * The shell's notice slot. The toast surface (`Toasts`) owns the auto-dismiss
 * countdown, its hover pause and the bar, so this only keeps which notice is
 * current and lets the surface clear it when its timer runs out.
 *
 * Every `notify` carries a fresh token, even when the text repeats: a notice
 * that arrives while its own wording is already on screen is still a new
 * arrival, and the toast surface starts it from full.
 */
export function useDropNotice(): {
  notice: ToastMessage | null;
  notify: (text: string) => void;
  clearNotice: () => void;
} {
  const [notice, setNotice] = useState<ToastMessage | null>(null);
  const nextToken = useRef(0);

  const clearNotice = useCallback((): void => setNotice(null), []);
  const notify = useCallback((text: string): void => {
    nextToken.current += 1;
    setNotice({ text, token: nextToken.current });
  }, []);

  return { notice, notify, clearNotice };
}
