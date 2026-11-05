import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The notice toast's auto-dismiss timer. Kept in a hook so the shell stays
 * under the god-file cap: a notice dismisses itself after NOTICE_MS, while
 * the shell's `notify` refreshes the timer on every new toast.
 */
const NOTICE_MS = 4000;

export function useDropNotice(): { notice: string | null; notify: (text: string) => void; clearNotice: () => void } {
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNotice = useCallback((): void => {
    setNotice(null);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const notify = useCallback(
    (text: string): void => {
      setNotice(text);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(clearNotice, NOTICE_MS);
    },
    [clearNotice],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return { notice, notify, clearNotice };
}
