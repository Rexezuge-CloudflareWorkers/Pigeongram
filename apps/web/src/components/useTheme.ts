import { useEffect, useState } from 'react';

/**
 * The `data-theme` value for the app root. Dark is the default (and the
 * only theme the loader line ships); light mirrors Telegram's official
 * light palette and persists across reloads. Kept in a hook so the shell
 * stays under the god-file cap.
 */
export type AppTheme = 'dark' | 'light';

export function useTheme(): { theme: AppTheme; setTheme: React.Dispatch<React.SetStateAction<AppTheme>> } {
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      return window.localStorage.getItem('pigeongram-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('pigeongram-theme', theme);
    } catch {
      /* non-blocking */
    }
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  return { theme, setTheme };
}
