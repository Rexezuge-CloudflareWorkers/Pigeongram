import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InviteDialog } from '../../apps/web/src/components/InviteDialog';
import type { ChatInvitePreviewDto } from '../../apps/web/src/types';

/**
 * The card a private invite link opens. It is the only place the account
 * decides to join a chat whose id Telegram has not named yet, so both actions
 * and the busy/requested states are the contract.
 */

const preview: ChatInvitePreviewDto = {
  title: 'Announcements',
  kind: 'channel',
  memberCount: 12_345,
  withApproval: false,
  about: 'News only',
};

function renderDialog(overrides: Partial<Parameters<typeof InviteDialog>[0]> = {}) {
  const onJoin = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <InviteDialog preview={preview} joining={false} requested={false} onJoin={onJoin} onClose={onClose} {...overrides} />,
  );
  return { ...view, onJoin, onClose };
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('InviteDialog', () => {
  it('describes the chat Telegram answered with and focuses Cancel', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: 'Join Chat' })).not.toBeNull();
    expect(screen.getByText('Announcements')).not.toBeNull();
    expect(screen.getByText('Channel · 12,345 Members')).not.toBeNull();
    expect(screen.getByText('News only')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('runs the join and the dismissal it was given', () => {
    const { onJoin, onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('warns that an admin has to approve the request', () => {
    renderDialog({ preview: { ...preview, withApproval: true } });

    expect(screen.getByText('An Admin Has To Approve Your Join Request.')).not.toBeNull();
  });

  it('keeps the card up with both actions disabled while joining', () => {
    const { onJoin, onClose } = renderDialog({ joining: true });

    expect(screen.getByRole('button', { name: 'Joining…' })).not.toBeNull();
    const buttons = screen.getAllByRole('button');
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Joining…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onJoin).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports a request Telegram accepted instead of offering the join again', () => {
    renderDialog({ requested: true });

    expect(screen.getByRole('button', { name: 'Request Sent' })).not.toBeNull();
    expect(screen.getByText('Your Join Request Was Sent.')).not.toBeNull();
    expect(screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });
});
