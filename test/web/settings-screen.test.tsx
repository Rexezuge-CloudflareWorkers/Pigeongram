import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from '../../apps/web/src/components/SettingsScreen';
import { DataSaverProvider } from '../../apps/web/src/data-saver';
import type { DataSaverControls, DataSaverSettings } from '../../apps/web/src/data-saver';

/**
The settings screen: one route and two navigations. Under 900px the index is
the screen and a section is pushed; at 900px and up a rail lists the sections
and the chosen one fills the pane. jsdom has no `matchMedia`, so the suite
stubs the wide query where it needs the rail.
*/

const ALL_ON: DataSaverSettings = {
  loadAvatars: true,
  loadPreviews: true,
  loadMedia: true,
  animateMedia: true,
  loadPinnedMessages: true,
};

afterEach(cleanup);

/**
Puts the narrow layout (the default when `matchMedia` is absent) back.
*/
beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'matchMedia');
});

function stubWide(): void {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      media: query,
      matches: query.includes('min-width'),
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function renderSettings(
  overrides: Partial<Parameters<typeof SettingsScreen>[0]> = {},
  dataSaver?: DataSaverControls,
): ReturnType<typeof render> {
  const screenBody = (
    <SettingsScreen
      section={null}
      theme="dark"
      onSetTheme={() => {}}
      seed="telegram"
      onSetSeed={() => {}}
      contrast="standard"
      onSetContrast={() => {}}
      onOpenSection={() => {}}
      onClose={() => {}}
      onError={() => {}}
      {...overrides}
    />
  );
  return render(dataSaver ? <DataSaverProvider value={dataSaver}>{screenBody}</DataSaverProvider> : screenBody);
}

function dataSaverControls(settings: Partial<DataSaverSettings> = {}): DataSaverControls {
  return { settings: { ...ALL_ON, ...settings }, setSetting: vi.fn() };
}

describe('SettingsScreen', () => {
  it('takes focus into the screen on entry', () => {
    renderSettings();

    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Settings' }));
  });

  it('lists the sections on the narrow index', () => {
    renderSettings();

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeDefined();
    // Only the rows are links into a section: no value summaries ride along.
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Data Saver' })).toBeDefined();
  });

  it('pushes a section from the index rather than replacing the entry', () => {
    const onOpenSection = vi.fn();
    renderSettings({ onOpenSection });

    fireEvent.click(screen.getByRole('button', { name: 'Data Saver' }));

    expect(onOpenSection).toHaveBeenCalledWith('data');
  });

  it('shows a section and focuses its heading', () => {
    renderSettings({ section: 'appearance' });

    const heading = screen.getByRole('heading', { name: 'Appearance' });
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull();
    expect(document.activeElement).toBe(heading);
  });

  it('steps out of settings from the header', () => {
    const onClose = vi.fn();
    renderSettings({ section: 'appearance', onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('steps out of settings with Escape', () => {
    const onClose = vi.fn();
    renderSettings({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the appearance controls', () => {
    renderSettings({ section: 'appearance' });

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Dark Mode' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Telegram Blue' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Medium' })).toBeDefined();
  });

  it('reports a new theme from the segmented control', () => {
    const onSetTheme = vi.fn();
    renderSettings({ section: 'appearance', onSetTheme });

    fireEvent.click(screen.getByRole('radio', { name: 'Light Mode' }));

    expect(onSetTheme).toHaveBeenCalledWith('light');
  });

  it('reports a new accent from the swatches', () => {
    const onSetSeed = vi.fn();
    renderSettings({ section: 'appearance', onSetSeed });

    fireEvent.click(screen.getByRole('radio', { name: 'Mint' }));

    expect(onSetSeed).toHaveBeenCalledWith('mint');
  });

  it('turns every data-saver choice on at once from the master switch', () => {
    const controls = dataSaverControls({ loadAvatars: false, loadMedia: false });
    renderSettings({ section: 'data' }, controls);

    const master = screen.getByRole('switch', { name: 'Data Saver' });
    // Some choices are off, so the master is neither on nor off.
    expect(master.getAttribute('aria-checked')).toBe('mixed');

    fireEvent.click(master);

    expect(controls.setSetting).toHaveBeenCalledTimes(5);
    for (const key of ['loadAvatars', 'loadPreviews', 'loadMedia', 'animateMedia', 'loadPinnedMessages']) {
      expect(controls.setSetting).toHaveBeenCalledWith(key, true);
    }
  });

  it('turns every data-saver choice off when all are on', () => {
    const controls = dataSaverControls();
    renderSettings({ section: 'data' }, controls);

    const master = screen.getByRole('switch', { name: 'Data Saver' });
    expect(master.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(master);

    expect(controls.setSetting).toHaveBeenCalledTimes(5);
    for (const key of ['loadAvatars', 'loadPreviews', 'loadMedia', 'animateMedia', 'loadPinnedMessages']) {
      expect(controls.setSetting).toHaveBeenCalledWith(key, false);
    }
  });

  it('keeps the individual data-saver switches', () => {
    const controls = dataSaverControls({ loadMedia: false });
    renderSettings({ section: 'data' }, controls);

    expect(screen.getByRole('switch', { name: 'Photos & Videos' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('switch', { name: 'Photos & Videos' }));

    expect(controls.setSetting).toHaveBeenCalledWith('loadMedia', true);
  });

  it('shows a rail and the chosen section on a wide window', () => {
    stubWide();
    const onOpenSection = vi.fn();
    renderSettings({ onOpenSection });

    // The index is not a desktop screen: the rail's default is the first section.
    expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(onOpenSection).toHaveBeenCalledWith('notifications', { replace: true });
  });

  it('leaves the settings index with the header on a wide window', () => {
    stubWide();
    const onClose = vi.fn();
    renderSettings({ section: 'appearance', onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
