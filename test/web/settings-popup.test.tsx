import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPopup } from '../../apps/web/src/components/SettingsPopup';
import { DataSaverProvider } from '../../apps/web/src/data-saver';
import type { DataSaverControls } from '../../apps/web/src/data-saver';

afterEach(cleanup);

function renderSettings(
  overrides: Partial<Parameters<typeof SettingsPopup>[0]> = {},
  dataSaver?: DataSaverControls,
): ReturnType<typeof render> {
  const popup = (
    <SettingsPopup
      theme="dark"
      seed="telegram"
      contrast="standard"
      onToggleTheme={() => {}}
      onSetSeed={() => {}}
      onSetContrast={() => {}}
      onClose={() => {}}
      {...overrides}
    />
  );
  return render(dataSaver ? <DataSaverProvider value={dataSaver}>{popup}</DataSaverProvider> : popup);
}

describe('SettingsPopup', () => {
  it('shows the current appearance choices', () => {
    renderSettings();

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    expect(screen.getByText('Appearance')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Light Mode' })).toBeDefined();
    expect((screen.getByRole('radio', { name: 'Telegram Blue' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('radio', { name: 'Standard' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
  });

  it('toggles the theme from the appearance row', () => {
    const onToggleTheme = vi.fn();
    renderSettings({ onToggleTheme });

    fireEvent.click(screen.getByRole('button', { name: 'Light Mode' }));

    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('reports the selected accent and contrast', () => {
    const onSetSeed = vi.fn();
    const onSetContrast = vi.fn();
    renderSettings({ onSetSeed, onSetContrast });

    fireEvent.click(screen.getByRole('radio', { name: 'Indigo' }));
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));

    expect(onSetSeed).toHaveBeenCalledWith('indigo');
    expect(onSetContrast).toHaveBeenCalledWith('high');
  });

  it('reflects and reports the data saver switches', () => {
    const setSetting = vi.fn();
    renderSettings(
      {},
      {
        settings: { loadAvatars: false, loadPreviews: true, loadMedia: true, animateMedia: true },
        setSetting,
      },
    );

    expect(screen.getByText('Data Saver')).toBeDefined();
    expect(screen.getByRole('switch', { name: 'Profile Pictures' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Link Previews' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('switch', { name: 'Link Previews' }));
    expect(setSetting).toHaveBeenCalledWith('loadPreviews', false);

    fireEvent.click(screen.getByRole('switch', { name: 'Photos & Videos' }));
    expect(setSetting).toHaveBeenLastCalledWith('loadMedia', false);
  });

  it('closes from Done, Escape and the scrim', () => {
    const onClose = vi.fn();
    renderSettings({ onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });
    fireEvent.click(document.querySelector<HTMLElement>('.dialog-scrim')!);

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('returns focus when it unmounts', () => {
    const returnFocus = vi.fn();
    const { unmount } = renderSettings({ returnFocus });

    unmount();

    expect(returnFocus).toHaveBeenCalledTimes(1);
  });
});
