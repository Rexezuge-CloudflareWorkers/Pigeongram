import { useCallback, useState } from 'react';

/**
 * The shell's notice slot. The toast surface (`Toasts`) owns the auto-dismiss
 * countdown, its hover pause and the bar, so this only keeps which notice is
 * current and lets the surface clear it when its timer runs out.
 */
export function useDropNotice(): { notice: string | null; notify: (text: string) => void; clearNotice: () => void } {
  const [notice, setNotice] = useState<string | null>(null);

  const clearNotice = useCallback((): void => setNotice(null), []);
  const notify = useCallback((text: string): void => setNotice(text), []);

  return { notice, notify, clearNotice };
}
