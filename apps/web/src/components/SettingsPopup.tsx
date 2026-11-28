import { useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useDataSaverControls, type DataSaverKey } from '../data-saver';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { ToggleSwitch } from './ToggleSwitch';
import { LanguageSettingsRow } from './LanguageSettingsRow';
import { useLanguage } from '../useLanguage';
import { useNotifications, type NotificationProblem } from '../pwa/useNotifications';
import { SEEDS, type Contrast, type Seed } from './useDynamicColor';

/**
The reader's settings, in a modal window.

Only the choices that belong to this device live here: the theme, the accent
seed, the contrast level and the data-saving switches. The account menu keeps
the actions that act on the account or navigate the app (the archive,
installing the app, signing out), so this window is the one place appearance
and media loading are changed.

The shared `Dialog` carries the modal behaviour — focus, the focus trap,
Escape and scrim dismissal — and the settings rows are plain controls inside
it. The choices persist through `useTheme`/`useDynamicColor` and
`useDataSaverPreferences`, so the controls only report the next value.
*/

interface SettingsPopupProps {
  theme: 'dark' | 'light';
  onToggleTheme?: () => void;
  seed: Seed;
  onSetSeed?: (seed: Seed) => void;
  contrast: Contrast;
  onSetContrast?: (contrast: Contrast) => void;
  onClose: () => void;
  /**
  Shows a setting failure in the app's failure toast.
  */
  onError?: (message: string) => void;
  /**
  Focuses this callback's target when the popup unmounts. Defaults to the
  element focused at mount, which can already be gone when the popup opens
  from a menu item.
  */
  returnFocus?: () => void;
  /**
  Whether the popup is animating out; forwarded to the shared Dialog.
  */
  exiting?: boolean;
}

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

const DATA_SAVER_ROWS: ReadonlyArray<{
  key: DataSaverKey;
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

export function SettingsPopup({
  theme,
  onToggleTheme,
  seed,
  onSetSeed,
  contrast,
  onSetContrast,
  onClose,
  onError = () => {},
  returnFocus,
  exiting = false,
}: SettingsPopupProps) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const appearanceId = useId();
  const notificationsId = useId();
  const dataSaverId = useId();
  const { settings: dataSaver, setSetting: onSetDataSaver } = useDataSaverControls();
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

  return (
    <Dialog
      title={t('settings.title', 'Settings')}
      onClose={onClose}
      returnFocus={returnFocus}
      exiting={exiting}
      className="max-w-[440px]"
      actions={
        <Button variant="text" onClick={onClose}>
          {t('common.done', 'Done')}
        </Button>
      }
    >
      <section className="flex flex-col gap-4" aria-labelledby={appearanceId}>
        <h3 id={appearanceId} className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t('settings.appearance', 'Appearance')}
        </h3>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm font-medium text-fg">
            <Icon name={theme === 'dark' ? 'dark-mode' : 'light-mode'} size={18} className="text-muted" />
            {t('settings.theme', 'Theme')}
          </span>
          <button
            type="button"
            className="rounded-full border border-outline px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? t('settings.lightMode', 'Light Mode') : t('settings.darkMode', 'Dark Mode')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-4" role="radiogroup" aria-label={t('settings.accent', 'Accent')}>
          <span className="text-sm font-medium text-fg">{t('settings.accent', 'Accent')}</span>
          <div className="flex gap-1.5">
            {SEEDS.map((option) => {
              const label = seedLabel(t, option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={seed === option.id}
                  aria-label={label}
                  title={label}
                  onClick={() => onSetSeed?.(option.id)}
                  className={`size-7 rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${seed === option.id ? 'border-primary' : 'border-transparent'}`}
                  style={{ background: option.hex }}
                />
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4" role="radiogroup" aria-label={t('settings.contrast', 'Contrast')}>
          <span className="text-sm font-medium text-fg">{t('settings.contrast', 'Contrast')}</span>
          <div className="flex gap-1">
            {(['standard', 'medium', 'high'] as const).map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={contrast === level}
                onClick={() => onSetContrast?.(level)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${contrast === level ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
              >
                {level === 'standard'
                  ? t('settings.contrastStandard', 'Standard')
                  : level === 'medium'
                    ? t('settings.contrastMedium', 'Medium')
                    : t('settings.contrastHigh', 'High')}
              </button>
            ))}
          </div>
        </div>
        <LanguageSettingsRow language={language} onChange={setLanguage} />
        {notifications.available ? (
          <section className="flex flex-col gap-2" aria-labelledby={notificationsId}>
            <h3 id={notificationsId} className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('settings.notifications', 'Notifications')}
            </h3>
            <div className="flex items-center justify-between gap-4" aria-busy={notifications.busy}>
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="notifications" size={18} className="shrink-0 text-muted" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-fg">{t('settings.notifications', 'Notifications')}</span>
                  <span className="text-xs text-muted">{t('settings.notificationsHint', 'Notify When A Message Arrives')}</span>
                </span>
              </span>
              <ToggleSwitch
                checked={notifications.enabled}
                label={t('a11y.notifications', 'Show notifications for new messages')}
                onChange={() => void notifications.toggle()}
              />
            </div>
          </section>
        ) : null}
      </section>
      <div className="h-px bg-line" role="separator" />
      <section className="flex flex-col gap-4" aria-labelledby={dataSaverId}>
        <h3 id={dataSaverId} className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t('settings.dataSaver', 'Data Saver')}
        </h3>
        {DATA_SAVER_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2">
              <Icon name={row.icon} size={18} className="shrink-0 text-muted" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-fg">{row.label(t)}</span>
                <span className="text-xs text-muted">{row.hint(t)}</span>
              </span>
            </span>
            <ToggleSwitch checked={dataSaver[row.key]} label={row.label(t)} onChange={(enabled) => onSetDataSaver(row.key, enabled)} />
          </div>
        ))}
      </section>
    </Dialog>
  );
}
