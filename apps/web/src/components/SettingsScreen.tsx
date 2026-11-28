import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SettingsSection } from '../routes';
import { Icon } from './Icon';
import { AppearanceSection, DataSaverSection, NotificationsSection, SETTINGS_SECTION_ROWS, SettingsIndex } from './SettingsSections';
import { StorageSection } from './StorageSection';
import { useMediaQuery } from './useMediaQuery';
import type { Contrast, Seed } from './useDynamicColor';

/**
The settings screen.

It is an overlay, not a modal: it covers the shell but the thread and the
sidebar stay mounted underneath, so stepping back returns to the same scroll
position and the same loaded window. The route names the screen
(`/settings`, `/settings/<section>`), so the back gesture, a reload and the
Android shell all step through it the same way.

Two navigations, one screen. At 900px and up a rail lists the sections and
the chosen one fills the pane — a tab switch, so the rail replaces the entry
and leaving settings stays one press. Narrower than that the index is the
screen: a section is pushed, and back returns to the list of sections, which
is what a phone reader expects.
*/

const DESKTOP_QUERY = '(min-width: 900px)';

interface SettingsScreenProps {
  /**
  The route's section, or null on the index.
  */
  section: SettingsSection | null;
  theme: 'dark' | 'light';
  onSetTheme: (theme: 'dark' | 'light') => void;
  seed: Seed;
  onSetSeed: (seed: Seed) => void;
  contrast: Contrast;
  onSetContrast: (contrast: Contrast) => void;
  onOpenSection: (section: SettingsSection, options?: { replace?: boolean }) => void;
  onClose: () => void;
  /**
  Shows a setting failure in the app's failure toast.
  */
  onError: (message: string) => void;
  /**
  Shows an outcome (a cleared cache) in the app's notice toast.
  */
  onNotice: (text: string) => void;
}

export function SettingsScreen({
  section,
  theme,
  onSetTheme,
  seed,
  onSetSeed,
  contrast,
  onSetContrast,
  onOpenSection,
  onClose,
  onError,
  onNotice,
}: SettingsScreenProps) {
  const { t } = useTranslation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  // The desktop rail never sits on the index: its default is the first section.
  const active: SettingsSection | null = desktop ? (section ?? 'appearance') : section;

  const headingRef = useRef<HTMLHeadingElement>(null);
  const rowRefs = useRef(new Map<SettingsSection, HTMLButtonElement>());
  const railRefs = useRef(new Map<SettingsSection, HTMLButtonElement>());
  const previousRef = useRef<SettingsSection | null>(null);
  const enteredRef = useRef(false);

  // Focus follows the level: opening a section moves focus to its heading (so
  // a screen reader announces it), and coming back to the index returns focus
  // to the row that was pressed. On the wide layout the rail is a tab switch,
  // so focus stays on the rail item. Entry is the same rule: the screen takes
  // focus rather than leaving it on the menu control that opened it.
  useEffect(() => {
    const first = !enteredRef.current;
    enteredRef.current = true;
    const previous = previousRef.current;
    previousRef.current = active;

    if (desktop) {
      if (first || active !== previous) railRefs.current.get(active ?? 'appearance')?.focus();
      return;
    }
    if (active !== null) {
      headingRef.current?.focus();
      return;
    }
    if (first) {
      headingRef.current?.focus();
      return;
    }
    if (previous !== null) rowRefs.current.get(previous)?.focus();
  }, [active, desktop]);

  // Escape is the back button, the same as the header's arrow.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="region"
      aria-label={t('settings.title', 'Settings')}
      data-testid="settings-screen"
      className="fixed inset-x-0 top-0 z-30 flex h-[100dvh] max-h-[var(--app-height,100dvh)] flex-col bg-surface text-on-surface"
    >
      <div className={`flex min-h-0 flex-1 ${desktop ? 'flex-row' : 'flex-col'}`}>
        {desktop ? (
          <SettingsRail
            active={active}
            onOpenSection={onOpenSection}
            onClose={onClose}
            buttonRef={(id, element) => {
              if (element === null) railRefs.current.delete(id);
              else railRefs.current.set(id, element);
            }}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {desktop ? null : <MobileHeader title={settingsLabel(t, active)} onClose={onClose} headingRef={headingRef} />}
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 p-4">
              {desktop && active !== null ? <h2 className="text-xl font-semibold">{settingsLabel(t, active)}</h2> : null}
              {active === null ? (
                <SettingsIndex
                  onOpen={(next) => onOpenSection(next)}
                  rowRef={(id, element) => {
                    if (element === null) rowRefs.current.delete(id);
                    else rowRefs.current.set(id, element);
                  }}
                />
              ) : (
                <SettingsSectionBody
                  section={active}
                  theme={theme}
                  onSetTheme={onSetTheme}
                  seed={seed}
                  onSetSeed={onSetSeed}
                  contrast={contrast}
                  onSetContrast={onSetContrast}
                  onError={onError}
                  onNotice={onNotice}
                />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

interface SettingsRailProps {
  active: SettingsSection | null;
  onOpenSection: (section: SettingsSection, options?: { replace?: boolean }) => void;
  onClose: () => void;
  /**
  Hands back each section's button, so entry can put focus on the rail item
  rather than leaving it on the menu control that opened the screen.
  */
  buttonRef?: (section: SettingsSection, element: HTMLButtonElement | null) => void;
}

/**
The wide window's navigation: a persistent rail beside the section, in the
shape of Telegram's own settings. Choosing a section replaces the history
entry, so leaving settings is one back press however many sections were read.
*/
function SettingsRail({ active, onOpenSection, onClose, buttonRef }: SettingsRailProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('settings.title', 'Settings')} className="flex w-[260px] shrink-0 flex-col border-r border-line p-3">
      <header className="flex min-h-12 items-center gap-2 px-1">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.back', 'Back')}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Icon name="arrow-left" />
        </button>
        <h1 className="truncate text-lg font-semibold">{t('settings.title', 'Settings')}</h1>
      </header>
      <ul className="mt-2 flex flex-col gap-0.5">
        {SETTINGS_SECTION_ROWS.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              ref={buttonRef === undefined ? undefined : (element) => buttonRef(row.id, element)}
              aria-current={active === row.id ? 'page' : undefined}
              onClick={() => onOpenSection(row.id, { replace: true })}
              className={`flex min-h-12 w-full items-center gap-3 rounded-full px-3 text-left font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                active === row.id ? 'bg-secondary-container text-on-secondary-container' : 'text-muted hover:bg-panel-2 hover:text-fg'
              }`}
            >
              <Icon name={row.icon} size={20} className="shrink-0" />
              <span className="truncate">{row.label(t)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface MobileHeaderProps {
  title: string;
  onClose: () => void;
  /**
  The screen's heading, focused when the screen opens and when a section is
  entered. Every level of the narrow layout has one, so focus always has the
  same target.
  */
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}

/**
The narrow window's header: back, then the level's title. The title is the
screen's heading, and the level focus moves to.
*/
function MobileHeader({ title, onClose, headingRef }: MobileHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-2">
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.back', 'Back')}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Icon name="arrow-left" />
      </button>
      <h1 ref={headingRef} tabIndex={-1} className="truncate text-lg font-semibold outline-none">
        {title}
      </h1>
    </header>
  );
}

interface SettingsSectionBodyProps {
  section: SettingsSection;
  theme: 'dark' | 'light';
  onSetTheme: (theme: 'dark' | 'light') => void;
  seed: Seed;
  onSetSeed: (seed: Seed) => void;
  contrast: Contrast;
  onSetContrast: (contrast: Contrast) => void;
  onError: (message: string) => void;
  onNotice: (text: string) => void;
}

function SettingsSectionBody({
  section,
  theme,
  onSetTheme,
  seed,
  onSetSeed,
  contrast,
  onSetContrast,
  onError,
  onNotice,
}: SettingsSectionBodyProps) {
  switch (section) {
    case 'appearance': {
      return (
        <AppearanceSection
          theme={theme}
          onSetTheme={onSetTheme}
          seed={seed}
          onSetSeed={onSetSeed}
          contrast={contrast}
          onSetContrast={onSetContrast}
        />
      );
    }
    case 'notifications': {
      return <NotificationsSection onError={onError} />;
    }
    case 'data': {
      return <DataSaverSection />;
    }
    case 'storage': {
      return <StorageSection onNotice={onNotice} />;
    }
  }
}

function settingsLabel(t: TFunction, section: SettingsSection | null): string {
  switch (section) {
    case 'appearance': {
      return t('settings.appearance', 'Appearance');
    }
    case 'notifications': {
      return t('settings.notifications', 'Notifications');
    }
    case 'data': {
      return t('settings.dataSaver', 'Data Saver');
    }
    case 'storage': {
      return t('settings.storage', 'Storage');
    }
    case null: {
      return t('settings.title', 'Settings');
    }
  }
}
