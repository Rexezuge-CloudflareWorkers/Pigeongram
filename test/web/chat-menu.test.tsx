import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMenu } from '../../apps/web/src/components/ChatMenu';
import type { DialogDto } from '../../apps/web/src/types';

/**
 * The chat list's context menu. Mark As Read clears an unread badge; an
 * already-read chat greys it out. A right-click inside the open menu must not
 * reopen it through the row's own handler.
 */

afterEach(cleanup);

function dialog(unread: number): DialogDto {
  return {
    chat: {
      id: 2,
      kind: 'user',
      title: 'Bob',
      username: 'bob',
      photo: null,
      canSendMessages: true,
      presence: null,
    },
    lastMessage: null,
    unread,
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
    archived: false,
  };
}

function renderMenu(unread: number, handlers: { onMarkRead?: (chatId: number) => void; onClose?: () => void } = {}) {
  const onMarkRead = handlers.onMarkRead ?? vi.fn();
  const onClose = handlers.onClose ?? vi.fn();
  render(<ChatMenu dialog={dialog(unread)} x={20} y={30} onMarkRead={onMarkRead} onClose={onClose} />);
  return { onMarkRead, onClose };
}

describe('ChatMenu', () => {
  it('offers Mark As Read as the one action', () => {
    renderMenu(3);

    expect(screen.getByRole('menu', { name: 'Chat actions' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Mark As Read' })).toBeDefined();
  });

  it('marks a chat read and closes the menu', () => {
    const { onMarkRead, onClose } = renderMenu(3);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark As Read' }));

    expect(onMarkRead).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables the action on an already-read chat', () => {
    renderMenu(0);

    expect((screen.getByRole('menuitem', { name: 'Mark As Read' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('swallows a right-click inside the menu so the row does not reopen it', () => {
    renderMenu(1);

    const menu = screen.getByRole('menu', { name: 'Chat actions' });
    expect(fireEvent.contextMenu(menu)).toBe(false);
  });
});
