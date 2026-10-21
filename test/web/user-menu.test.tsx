import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMenu } from '../../pages/src/components/UserMenu';
import type { MeDto } from '../../pages/src/types';

afterEach(cleanup);

const me: MeDto = { id: 1, firstName: 'Ada', lastName: 'Lovelace', username: 'ada', phone: null, photo: null };

function renderMenu(onSignOut: () => Promise<void> | void = async () => {}): HTMLButtonElement {
  render(<UserMenu me={me} connected onSignOut={onSignOut} />);
  return screen.getByRole('button', { name: 'Account menu for Ada Lovelace' });
}

function openMenu(trigger: HTMLButtonElement): HTMLElement {
  fireEvent.click(trigger);
  return screen.getByRole('menu', { name: 'Account menu' });
}

function requestSignOut(trigger: HTMLButtonElement): HTMLElement {
  const menu = openMenu(trigger);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
  return screen.getByRole('dialog', { name: 'Sign out of Telegram?' });
}

describe('UserMenu', () => {
  it('opens the account menu from the profile control and keeps sign out inside', () => {
    const onSignOut = vi.fn();
    const trigger = renderMenu(onSignOut);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu', { name: 'Account menu' })).toBeNull();

    const menu = openMenu(trigger);
    const item = within(menu).getByRole('menuitem', { name: 'Sign out' });

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(within(menu).getByText('@ada')).toBeDefined();
    expect(document.activeElement).toBe(item);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('asks for confirmation and cancels without signing out', () => {
    const onSignOut = vi.fn(async () => {});
    const trigger = renderMenu(onSignOut);

    const dialog = requestSignOut(trigger);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(within(dialog).getByText(/ends the session on this client/i)).toBeDefined();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onSignOut).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('confirms once and disables both actions while signing out', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onSignOut = vi.fn(() => pending);
    const trigger = renderMenu(onSignOut);

    const dialog = requestSignOut(trigger);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'Signing out…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      finish();
      await pending;
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses the menu and the confirmation with Escape', () => {
    const onSignOut = vi.fn();
    const trigger = renderMenu(onSignOut);

    fireEvent.keyDown(openMenu(trigger), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    const dialog = requestSignOut(trigger);
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSignOut).not.toHaveBeenCalled();
  });
});
