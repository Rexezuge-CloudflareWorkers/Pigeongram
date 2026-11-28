import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DATA_SAVER_KEYS, useDataSaverControls } from '../data-saver';
import { useLanguage } from '../useLanguage';
import { useNotifications, type NotificationProblem } from '../pwa/useNotifications';
import type { SettingsSection } from '../routes';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { LanguageSettingsRow } from './LanguageSettingsRow';
import { ChoiceGroup, SettingsNavRow, SettingsRow, SettingsSwitchRow } from './SettingsRow';
import { SEEDS, type Contrast, type Seed } from './useDynamicColor';

/**
The settings screen's bodies: the mobile index and the three sections.

Each section is a list of rows from `SettingsRow`, so the screen has one row
shape whatever the control. The copy is the existing settings catalogue; the
only new string is the data-saver master's hint.
*/

export const SETTINGS_SECTION_ROWS: ReadonlyArray<{
  id: SettingsSection;
  icon: IconName;
  label: (t: TFunction) => string;
}> = [
  { id: 'appearance', icon: 'palette', label: (t) => t('settings.appearance', 'Appearance') },
  { id: 'notifications', icon: 'notifications', label: (t) => t('settings.notifications', 'Notifications') },
  { id: 'data', icon: 'image', label: (t) => t('settings.dataSaver', 'Data Saver') },
];

const DATA_SAVER_ROWS: ReadonlyArray<{
  key: (typeof DATA_SAVER_KEYS)[number];
  label: (t: TFunction) => string;
  hint: (t: TFunction) => string;
  icon: IconName;
}> = [
  {
    key: 'loadAvatars',
    label: (t) => t('settings.profiles', 'Profile Pictures'),
    hint: (t) => t('settings.profilesHint', 'Show Profile Photos Across The App'),
    icon: 'person',
  },
  {
    key: 'loadPreviews',
    label: (t) => t('settings.linkPreviews', 'Link Previews'),
    hint: (t) => t('settings.linkPreviewsHint', 'Load Link Preview Thumbnails'),
    icon: 'link',
  },
  {
    key: 'loadMedia',
    label: (t) => t('settings.media', 'Photos & Videos'),
    hint: (t) => t('settings.mediaHint', 'Fetch Photo And Video Thumbnails'),
    icon: 'image',
  },
  {
    key: 'animateMedia',
    label: (t) => t('settings.animate', 'Autoplay Media'),
    hint: (t) => t('settings.animateHint', 'Play GIFs, Video Stickers And Animated Stickers'),
    icon: 'gif',
  },
  {
    key: 'loadPinnedMessages',
    label: (t) => t('settings.pinned', 'Pinned Messages'),
    hint: (t) => t('settings.pinnedHint', 'Load Pinned Messages When Opening A Chat'),
    icon: 'pin',
  },
];

/**
The accessible name of an accent swatch. A literal key per seed keeps the
call-site scanner able to see every label; the colour is data, not copy.
*/
function seedLabel(t: TFunction, seed: Seed): string {
  switch (seed) {
    case 'telegram': {
      return t('a11y.seedTelegram', 'Telegram Blue');
    }
    case 'indigo': {
      return t('a11y.seedIndigo', 'Indigo');
    }
    case 'amber': {
      return t('a11y.seedAmber', 'Amber');
    }
    case 'mint': {
      return t('a11y.seedMint', 'Mint');
    }
    case 'rose': {
      return t('a11y.seedRose', 'Rose');
    }
  }
}

interface SettingsIndexProps {
  onOpen: (section: SettingsSection) => void;
  /**
  Hands back each row's button, so the screen can restore focus to the row a
  section was opened from.
  */
  rowRef?: (section: SettingsSection, element: HTMLButtonElement | null) => void;
}

export function SettingsIndex({ onOpen, rowRef }: SettingsIndexProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('settings.title', 'Settings')} className="flex flex-col gap-0.5">
      {SETTINGS_SECTION_ROWS.map((row) => (
        <SettingsNavRow
          key={row.id}
          icon={row.icon}
          label={row.label(t)}
          onSelect={() => onOpen(row.id)}
          buttonRef={rowRef === undefined ? undefined : (element) => rowRef(row.id, element)}
        />
      ))}
    </nav>
  );
}

interface AppearanceSectionProps {
  theme: 'dark' | 'light';
  onSetTheme: (theme: 'dark' | 'light') => void;
  seed: Seed;
  onSetSeed: (seed: Seed) => void;
  contrast: Contrast;
  onSetContrast: (contrast: Contrast) => void;
}

export function AppearanceSection({ theme, onSetTheme, seed, onSetSeed, contrast, onSetContrast }: AppearanceSectionProps) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  return (
    <div className="flex flex-col divide-y divide-line">
      <SettingsRow label={t('settings.theme', 'Theme')}>
        <ChoiceGroup
          label={t('settings.theme', 'Theme')}
          value={theme}
          options={[
            { value: 'light', label: t('settings.lightMode', 'Light Mode') },
            { value: 'dark', label: t('settings.darkMode', 'Dark Mode') },
          ]}
          onChange={onSetTheme}
        />
      </SettingsRow>
      <SettingsRow label={t('settings.accent', 'Accent')}>
        <div role="radiogroup" aria-label={t('settings.accent', 'Accent')} className="flex shrink-0 gap-1.5">
          {SEEDS.map((option) => {
            const label = seedLabel(t, option.id);
            const selected = seed === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                title={label}
                onClick={() => onSetSeed(option.id)}
                className={`flex size-7 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  selected ? 'border-primary' : 'border-transparent'
                }`}
                style={{ background: option.hex }}
              >
                {selected ? <Icon name="check" size={16} className="text-white drop-shadow" /> : null}
              </button>
            );
          })}
        </div>
      </SettingsRow>
      <SettingsRow label={t('settings.contrast', 'Contrast')}>
        <ChoiceGroup
          label={t('settings.contrast', 'Contrast')}
          value={contrast}
          options={[
            { value: 'standard', label: t('settings.contrastStandard', 'Standard') },
            { value: 'medium', label: t('settings.contrastMedium', 'Medium') },
            { value: 'high', label: t('settings.contrastHigh', 'High') },
          ]}
          onChange={onSetContrast}
        />
      </SettingsRow>
      <div className="py-2">
        <LanguageSettingsRow language={language} onChange={setLanguage} />
      </div>
    </div>
  );
}

interface NotificationsSectionProps {
  /**
  Shows a refused or failed subscription in the app's failure toast.
  */
  onError: (message: string) => void;
}

export function NotificationsSection({ onError }: NotificationsSectionProps) {
  const { t } = useTranslation();
  const reportProblem = useCallback(
    (problem: NotificationProblem): void => {
      const message = {
        denied: t('settings.notificationsDenied', 'Notifications Are Blocked — Allow Them In Your Browser Settings'),
        unsupported: t('settings.notificationsUnsupported', 'Notifications Are Not Available In This Browser'),
        failed: t('settings.notificationsFailed', 'Notifications Could Not Be Changed'),
        limit: t('settings.notificationsLimit', 'Too Many Devices Are Subscribed To Notifications'),
      }[problem];
      onError(message);
    },
    [onError, t],
  );
  const notifications = useNotifications(reportProblem);

  if (!notifications.available) {
    return (
      <p className="py-2 text-sm text-muted">{t('settings.notificationsUnsupported', 'Notifications Are Not Available In This Browser')}</p>
    );
  }
  return (
    <SettingsSwitchRow
      icon="notifications"
      label={t('settings.notifications', 'Notifications')}
      hint={t('settings.notificationsHint', 'Notify When A Message Arrives')}
      checked={notifications.enabled}
      busy={notifications.busy}
      onChange={() => void notifications.toggle()}
    />
  );
}

export function DataSaverSection() {
  const { t } = useTranslation();
  const { settings, setSetting } = useDataSaverControls();
  const allOn = DATA_SAVER_KEYS.every((key) => settings[key]);
  const anyOn = DATA_SAVER_KEYS.some((key) => settings[key]);
  const setAll = (enabled: boolean): void => {
    for (const key of DATA_SAVER_KEYS) setSetting(key, enabled);
  };
  return (
    <div className="flex flex-col">
      <SettingsSwitchRow
        icon="download"
        label={t('settings.dataSaver', 'Data Saver')}
        hint={t('settings.dataSaverHint', 'Turn Every Optional Download Off At Once')}
        checked={allOn}
        indeterminate={!allOn && anyOn}
        onChange={setAll}
      />
      <div className="my-2 h-px bg-line" role="separator" />
      {DATA_SAVER_ROWS.map((row) => (
        <SettingsSwitchRow
          key={row.key}
          icon={row.icon}
          label={row.label(t)}
          hint={row.hint(t)}
          checked={settings[row.key]}
          onChange={(enabled) => setSetting(row.key, enabled)}
        />
      ))}
    </div>
  );
}
