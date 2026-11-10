import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePopup } from '../../apps/web/src/components/ProfilePopup';
import type { ChatDto, ProfileDto } from '../../apps/web/src/types';

/**
 * The peer's profile card.
 *
 * The card owns the modal behaviours the rest of the SPA expects: focus moves
 * into it, Tab stays inside, Escape and the scrim close it, and the opener
 * gets focus back.
 */

afterEach(cleanup);

const chat: ChatDto = {
  id: 2,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
  presence: { status: 'online', lastSeenAt: null },
};

const profile: ProfileDto = {
  id: 2,
  kind: 'user',
  title: 'Bob Smith',
  username: 'bobsmith',
  about: 'Ships things.',
  photo: 'v2',
  membersCount: null,
};

function renderPopup(
  options: {
    chat?: ChatDto;
    profile?: ProfileDto | null;
    loading?: boolean;
    error?: string | null;
    onClose?: () => void;
    returnFocus?: () => void;
  } = {},
): void {
  render(
    <ProfilePopup
      chat={options.chat ?? chat}
      profile={options.profile ?? null}
      loading={options.loading ?? false}
      error={options.error ?? null}
      onClose={options.onClose ?? (() => {})}
      returnFocus={options.returnFocus}
    />,
  );
}

describe('ProfilePopup', () => {
  it('paints the chat it already knows before the profile read lands', () => {
    renderPopup();

    expect(screen.getByRole('dialog', { name: 'Bob' })).toBeDefined();
    expect(screen.getByText('@bob')).toBeDefined();
    expect(screen.getByText('Online')).toBeDefined();
    expect(screen.queryByText('Ships things.')).toBeNull();
  });

  it('fills in the bio, the handle and the member count from the profile', () => {
    renderPopup({
      profile: { ...profile, membersCount: 1234 },
      chat: { ...chat, kind: 'supergroup', title: 'Team', username: null, presence: null },
    });

    expect(screen.getByText('Bob Smith')).toBeDefined();
    expect(screen.getByText('@bobsmith')).toBeDefined();
    expect(screen.getByText('Ships things.')).toBeDefined();
    expect(screen.getByText('1,234 Members')).toBeDefined();
  });

  it('shows the read in flight and then its failure', () => {
    const { rerender } = render(<ProfilePopup chat={chat} profile={null} loading error={null} onClose={() => {}} />);
    expect(screen.getByText('Loading The Profile…')).toBeDefined();

    rerender(<ProfilePopup chat={chat} profile={null} loading={false} error="Could not load" onClose={() => {}} />);
    expect(screen.getByText('Could not load')).toBeDefined();
    expect(screen.queryByText('Ships things.')).toBeNull();
  });

  it('closes on Escape from anywhere', () => {
    const onClose = vi.fn();
    renderPopup({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on the scrim but not on the card', () => {
    const onClose = vi.fn();
    renderPopup({ onClose });
    const dialog = screen.getByRole('dialog');

    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Tab inside the card', () => {
    renderPopup();
    const close = screen.getByRole('button', { name: 'Close The Profile' });
    const outside = document.createElement('button');
    // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
    document.body.appendChild(outside);

    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    outside.remove();
  });

  it('returns focus to the opener when it unmounts', () => {
    const opener = document.createElement('button');
    // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<ProfilePopup chat={chat} profile={null} loading={false} error={null} onClose={() => {}} />);
    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('uses the caller’s return-focus callback when it supplies one', () => {
    const returnFocus = vi.fn();
    const { unmount } = render(
      <ProfilePopup chat={chat} profile={null} loading={false} error={null} onClose={() => {}} returnFocus={returnFocus} />,
    );

    unmount();

    expect(returnFocus).toHaveBeenCalledOnce();
  });
});
