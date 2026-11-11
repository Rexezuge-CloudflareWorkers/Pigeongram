import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPopup } from '../../apps/web/src/components/SettingsPopup';

afterEach(cleanup);

function renderSettings(overrides: Partial<Parameters<typeof SettingsPopup>[0]> = {}): ReturnType<typeof render> {
  return render(
    <SettingsPopup
      theme="dark"
      seed="telegram"
      contrast="standard"
      onToggleTheme={() => {}}
      onSetSeed={() => {}}
      onSetContrast={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  );
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
