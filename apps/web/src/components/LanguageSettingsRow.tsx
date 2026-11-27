import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LOCALE_NAMES } from '../i18n';
import { Select } from './Select';

/**
The language row in the settings popup.

Per device, like the theme and the data-saver switches: the choice is stored in
`localStorage` under `LANGUAGE_STORAGE_KEY` (by `useLanguage`) and never reaches
the engine — the account's `MeDto` carries no language.

The row is offered only when there is more than one language to pick: a
selector with a single option is a control that cannot do anything yet.
*/
export function LanguageSettingsRow({
  language,
  onChange,
  disabled,
}: {
  language: string;
  onChange: (language: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (SUPPORTED_LANGUAGES.length < 2) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">{t('settings.language', 'Language')}</span>
      <Select
        aria-label={t('a11y.selectLanguage', 'Select Language')}
        value={language}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {SUPPORTED_LANGUAGES.map((tag) => (
          <option key={tag} value={tag}>
            {LOCALE_NAMES[tag]}
          </option>
        ))}
      </Select>
      <span className="text-xs text-muted">{t('settings.languageHint', 'Choose Your Preferred Display Language.')}</span>
    </div>
  );
}
