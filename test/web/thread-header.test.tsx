import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadHeader } from '../../pages/src/components/ThreadHeader';
import type { ChatDto, ProfileDto } from '../../pages/src/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});

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
  title: 'Bob',
  username: 'bob',
  about: 'Ships things.',
  photo: null,
  membersCount: null,
};

/**
The profiles the mocked bridge knows: one per peer.
*/
const PEERS: Record<number, ProfileDto> = {
  2: profile,
  3: { id: 3, kind: 'user', title: 'Carol', username: 'carol', about: null, photo: null, membersCount: null },
};

/**
Answers the profile read. Without a body the answer is the profile of the
peer that was asked for.
*/
function installProfileFetch(body?: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const reply = (payload: unknown): Response => Response.json(payload, { status, headers: { 'content-type': 'application/json' } });
      if (body !== undefined) return reply(body);
      const params = (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { params?: { chatId?: number } }).params ?? {};
      const chatId = params.chatId ?? 0;
      return reply({ profile: PEERS[chatId] ?? { ...profile, id: chatId, about: null } });
    }),
  );
}

function renderHeader(
  peer: ChatDto = chat,
  options: { archived?: boolean; onSetArchived?: (archived: boolean) => Promise<void> } = {},
): void {
  render(
    <ThreadHeader
      chat={peer}
      presence={peer.presence}
      archived={options.archived ?? false}
      onBack={() => {}}
      onSetArchived={options.onSetArchived ?? (async () => {})}
    />,
  );
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `Menu for ${chat.title}` }));
  return screen.getByRole('menu', { name: `Menu for ${chat.title}` });
}

describe('ThreadHeader', () => {
  it('opens the profile from the name and reads it', async () => {
    installProfileFetch();
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ships things.')).toBeDefined();
    expect(within(dialog).getByText('@bob')).toBeDefined();
    expect(within(dialog).getByText('online')).toBeDefined();
  });

  it('opens the profile from the picture', async () => {
    installProfileFetch();
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'View the profile of Bob' }));

    expect(await screen.findByRole('dialog')).toBeDefined();
  });

  it('reads the profile only when it is asked for', () => {
    const fetchMock = vi.fn(async () => Response.json({ profile }));
    vi.stubGlobal('fetch', fetchMock);
    renderHeader();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the profile from the menu', async () => {
    installProfileFetch();
    renderHeader();

    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'View Profile' }));

    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers the handle actions only for a chat with a handle', () => {
    installProfileFetch();
    renderHeader();

    const menu = openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Copy @bob' })).toBeDefined();
    expect(within(menu).getByRole('menuitem', { name: 'Open in Telegram' })).toBeDefined();

    cleanup();
    renderHeader({ ...chat, username: null });
    const plain = openMenu();
    expect(within(plain).getByRole('menuitem', { name: 'View Profile' })).toBeDefined();
    expect(within(plain).queryByRole('menuitem', { name: 'Copy @bob' })).toBeNull();
    expect(within(plain).queryByRole('menuitem', { name: 'Open in Telegram' })).toBeNull();
  });

  it('copies the handle and says so on the item', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    installProfileFetch();
    renderHeader();

    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy @bob' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('@bob'));
    expect(await within(menu).findByText('Copied')).toBeDefined();
  });

  it('closes the profile with Escape and gives the focus back', async () => {
    installProfileFetch();
    renderHeader();

    const name = screen.getByRole('button', { name: 'Bob' });
    fireEvent.click(name);
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(name);
  });

  it('reports a profile that could not be read', async () => {
    installProfileFetch({ error: 'Peer not found' }, 404);
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Peer not found')).toBeDefined());
  });

  it('never describes another peer with the profile it read', async () => {
    installProfileFetch();
    const { rerender } = render(
      <ThreadHeader chat={chat} presence={chat.presence} archived={false} onBack={() => {}} onSetArchived={async () => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));
    expect(await screen.findByText('Ships things.')).toBeDefined();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const other: ChatDto = { ...chat, id: 3, title: 'Carol', username: 'carol' };
    rerender(<ThreadHeader chat={other} presence={other.presence} archived={false} onBack={() => {}} onSetArchived={async () => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Carol' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Ships things.')).toBeNull();
    expect(within(dialog).getByText('Carol')).toBeDefined();
    expect(within(dialog).getByText('@carol')).toBeDefined();
  });

  it('keeps the archive action in the menu and asks before it moves the chat', async () => {
    installProfileFetch();
    const onSetArchived = vi.fn(async () => {});
    renderHeader(chat, { onSetArchived });

    // The header itself carries no archive button any more.
    expect(screen.queryByRole('button', { name: 'Archive chat' })).toBeNull();

    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive chat' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Archive this chat?')).toBeDefined();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSetArchived).not.toHaveBeenCalled();

    // The move runs once the reader confirms it.
    const again = openMenu();
    fireEvent.click(within(again).getByRole('menuitem', { name: 'Archive chat' }));

    const confirmed = await screen.findByRole('dialog');
    fireEvent.click(within(confirmed).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(onSetArchived).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers to bring an archived chat back', async () => {
    installProfileFetch();
    const onSetArchived = vi.fn(async () => {});
    renderHeader(chat, { archived: true, onSetArchived });

    const menu = openMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Archive chat' })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Unarchive chat' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Bring the chat back?')).toBeDefined();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unarchive' }));

    await waitFor(() => expect(onSetArchived).toHaveBeenCalledWith(false));
  });
});
