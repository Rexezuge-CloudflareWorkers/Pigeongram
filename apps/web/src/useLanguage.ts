import { useCallback, useEffect, useState } from 'react';
import { i18n, LANGUAGE_STORAGE_KEY, normalizeLanguage, SUPPORTED_LANGUAGES } from './i18n';

/**
The reader's language, and the one function that changes it.

The choice belongs to the device and lives in `localStorage`; i18next owns the
strings. This hook is the seam between the two: it reads the language i18next
actually has, persists the choice, syncs `<html lang>`, and hands the change to
i18next so the next render is in the chosen language.

`SUPPORTED_LANGUAGES` is shared, not copied: the selector's list and the
catalogue's directories are checked against each other by `validate:locales`.
*/
export function useLanguage(): { language: string; setLanguage: (language: string) => void } {
  // i18next is the source of truth for what is rendered: its `languageChanged`
  // event also fires for a change made outside this hook.
  const [active, setActive] = useState(() => normalizeLanguage(i18n.language));

  useEffect(() => {
    const onChange = (next: string): void => setActive(normalizeLanguage(next));
    i18n.on('languageChanged', onChange);
    return () => {
      i18n.off('languageChanged', onChange);
    };
  }, []);

  const choose = useCallback((next: string): void => {
    const normalized = normalizeLanguage(next);
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(normalized)) return;
    try {
      globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, normalized);
    } catch {
      // A reader in private mode still gets the language for this session.
    }
    void i18n.changeLanguage(normalized);
  }, []);

  return { language: active, setLanguage: choose };
}
