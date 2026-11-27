import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LocaleUtil, LOCALE_DISPLAY_NAMES } from '@rexezuge/shared';
import en from './locales/en/translation.json';

/**
The SPA's string catalogue.

English is the base and the only language that ships today: the catalogue, the
selectors, the validator and the tests are all in place, so adding a language is
a directory and one entry in `SUPPORTED_LANGUAGES` rather than a refactor.

Every entry must be a tag `@rexezuge/shared` supports; `validate:locales`
cross-checks the list against the shipped bundle directories in both
directions, so a language can never be offered without a catalogue.

`apps/web/src/locales/en/translation.json` is the copy. A visible string is
Title Case (`AGENTS.md`), and accessible-only copy lives under `a11y.*` where
the guard expects sentence case instead.
*/
export const SUPPORTED_LANGUAGES = ['en'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'pigeongram-language';

/**
The language names in the selector, from the kit so a new tag arrives with a
name rather than with its raw code.
*/
export const LOCALE_NAMES: Record<SupportedLanguage, string> = LOCALE_DISPLAY_NAMES;

/**
Resolves a tag onto a language this app ships: the kit's normalization first
(a regional variant onto its base, `zh` onto `zh-CN`), then the offered list.
A tag the app does not ship falls back to English rather than to a language
with no catalogue.
*/
export function normalizeLanguage(tag: string | null | undefined): SupportedLanguage {
  const normalized = LocaleUtil.normalize(tag);
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(normalized) ? (normalized as SupportedLanguage) : 'en';
}

/**
The stored language choice, or `null` when there is none or storage is
unavailable (private mode throws on access).
*/
function readStoredLanguage(): string | null {
  try {
    return globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function readNavigatorLanguage(): string | null {
  try {
    return globalThis.navigator?.language ?? null;
  } catch {
    return null;
  }
}

/**
The language to start in: the reader's stored choice, then the browser's, then
English. The first *present* source wins — an unsupported stored value falls to
English rather than to the browser, because the stored value is the reader's own
choice.
*/
export function detectInitialLanguage(): SupportedLanguage {
  const stored = readStoredLanguage();
  const chosen = [stored, readNavigatorLanguage()].find((value) => typeof value === 'string' && value !== '');
  return normalizeLanguage(chosen);
}

const resources = {
  en: { translation: en },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: detectInitialLanguage(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}

/**
The instance, for the modules that translate without a hook: `format.ts`, the
login copy and the recorder's refusals.
*/

/**
Translates outside a component.

Importing this instance rather than a standalone `t` keeps one language for the
whole app: `useTranslation` and these calls read the same store, so a language
change reaches the format helpers on the next render too.
*/
export const t = i18n.t.bind(i18n);

export { default as i18n } from 'i18next';
