import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatDto } from '../../apps/web/src/types';

/**
 * The new-message picker: the contacts read on open, the debounced Telegram
 * search while typing, and the row the reader chooses.
 *
 * The bridge call is replaced so the test drives the answers; the timing rule
 * (a late answer must not replace a newer query) is asserted with one answer
 * held open across a second search.
 */
const bridge = vi.hoisted(() => ({ searchContacts: vi.fn() }));

vi.mock('../../apps/web/src/api', () => bridge);

const { NewChatDialog } = await import('../../apps/web/src/components/NewChatDialog');

afterEach(() => {
  cleanup();
  bridge.searchContacts.mockReset();
});

function chat(overrides: Partial<ChatDto> & Pick<ChatDto, 'id' | 'title'>): ChatDto {
  return {
    kind: 'user',
    username: null,
    photo: null,
    canSendMessages: true,
    canDeleteMessages: true,
    canPinMessages: true,
    presence: null,
    ...overrides,
  };
}

const ada = chat({ id: 1, title: 'Ada', username: 'ada' });
const bob = chat({ id: 2, title: 'Bob', username: 'bob' });
const carol = chat({ id: 3, title: 'Carol', username: 'carol' });
const announce = chat({ id: 20, title: 'Announcements', username: 'announce', kind: 'channel' });

function renderDialog(overrides: { onSelect?: (chat: ChatDto) => void; onClose?: () => void } = {}): {
  onSelect: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const onSelect = vi.fn(overrides.onSelect);
  const onClose = vi.fn(overrides.onClose);
  render(<NewChatDialog onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose };
}

describe('NewChatDialog', () => {
  it('opens on the address book and opens the row the reader chooses', async () => {
    bridge.searchContacts.mockResolvedValue({ people: [ada, bob], chats: [] });
    const { onSelect } = renderDialog();

    expect(screen.getByRole('dialog', { name: 'New Message' })).toBeDefined();
    expect(await screen.findByText('Ada')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
    expect(screen.getByText('Contacts')).toBeDefined();
    expect(bridge.searchContacts).toHaveBeenCalledWith();

    fireEvent.click(screen.getByRole('button', { name: /Ada/ }));

    expect(onSelect).toHaveBeenCalledWith(ada);
  });

  it('searches Telegram after typing settles and sections people from chats', async () => {
    bridge.searchContacts.mockResolvedValueOnce({ people: [ada], chats: [] }).mockResolvedValueOnce({
      people: [bob],
      chats: [announce],
    });
    renderDialog();

    await screen.findByText('Ada');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people and chats' }), { target: { value: 'bo' } });

    expect(await screen.findByText('Bob')).toBeDefined();
    expect(screen.getByText('Announcements')).toBeDefined();
    expect(screen.getByText('People')).toBeDefined();
    expect(screen.getByText('Chats')).toBeDefined();
    expect(bridge.searchContacts).toHaveBeenLastCalledWith({ query: 'bo', limit: 20 });
  });

  it('never shows a slow answer for a query the reader already replaced', async () => {
    let releaseSlow: (value: { people: ChatDto[]; chats: ChatDto[] }) => void = () => {};
    const slow = new Promise<{ people: ChatDto[]; chats: ChatDto[] }>((resolve) => {
      releaseSlow = resolve;
    });
    bridge.searchContacts
      .mockResolvedValueOnce({ people: [ada], chats: [] })
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ people: [bob], chats: [] });
    renderDialog();

    await screen.findByText('Ada');
    const input = screen.getByRole('searchbox', { name: 'Search people and chats' });

    fireEvent.change(input, { target: { value: 'a' } });
    await waitFor(() => expect(bridge.searchContacts).toHaveBeenCalledTimes(2));
    fireEvent.change(input, { target: { value: 'bo' } });
    expect(await screen.findByText('Bob')).toBeDefined();

    await act(async () => {
      releaseSlow({ people: [carol], chats: [] });
    });

    expect(screen.queryByText('Carol')).toBeNull();
    expect(screen.getByText('Bob')).toBeDefined();
  });

  it('keeps a failed read inline and retries it', async () => {
    bridge.searchContacts.mockRejectedValueOnce(new Error('The Contacts Could Not Be Read')).mockResolvedValueOnce({
      people: [ada],
      chats: [],
    });
    renderDialog();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The Contacts Could Not Be Read');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Ada')).toBeDefined();
    expect(bridge.searchContacts).toHaveBeenCalledTimes(2);
  });

  it('says so when nothing is found, and when the account has no contacts', async () => {
    bridge.searchContacts.mockResolvedValueOnce({ people: [], chats: [] }).mockResolvedValueOnce({ people: [], chats: [] });
    renderDialog();

    expect(await screen.findByText('No Contacts Yet. Search By Name Or Username.')).toBeDefined();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people and chats' }), { target: { value: 'zzz' } });

    expect(await screen.findByText('Nothing Found For “zzz”.')).toBeDefined();
  });

  it('closes on Escape', async () => {
    bridge.searchContacts.mockResolvedValue({ people: [], chats: [] });
    const { onClose } = renderDialog();

    await screen.findByText('No Contacts Yet. Search By Name Or Username.');
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('dismisses through its close button and the scrim, and swallows the scrim gestures', async () => {
    bridge.searchContacts.mockResolvedValue({ people: [], chats: [] });
    const { onClose } = renderDialog();

    await screen.findByText('No Contacts Yet. Search By Name Or Username.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close New Message' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    const scrim = screen.getByRole('dialog', { name: 'New Message' }).parentElement as HTMLElement;
    fireEvent.pointerDown(scrim);
    fireEvent.doubleClick(scrim);
    fireEvent.contextMenu(scrim);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('moves focus into the list with Arrow Down, and stays put when there is nothing to focus', async () => {
    bridge.searchContacts.mockResolvedValue({ people: [ada], chats: [] });
    renderDialog();

    const input = screen.getByRole('searchbox', { name: 'Search people and chats' });
    await screen.findByText('Ada');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Ada/ }));

    cleanup();
    bridge.searchContacts.mockResolvedValue({ people: [], chats: [] });
    renderDialog();
    await screen.findByText('No Contacts Yet. Search By Name Or Username.');
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search people and chats' }), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search people and chats' }));
  });

  it('names a peer without a public handle by its kind', async () => {
    bridge.searchContacts.mockResolvedValue({
      people: [
        chat({ id: 1, title: 'A Person', kind: 'user' }),
        chat({ id: 2, title: 'A Bot', kind: 'bot' }),
        chat({ id: 3, title: 'A Group', kind: 'group' }),
        chat({ id: 4, title: 'A Supergroup', kind: 'supergroup' }),
        chat({ id: 5, title: 'A Channel', kind: 'channel' }),
      ],
      chats: [],
    });
    renderDialog();

    expect(await screen.findByText('Contact')).toBeDefined();
    expect(screen.getByText('Bot')).toBeDefined();
    expect(screen.getByText('Group')).toBeDefined();
    expect(screen.getByText('Supergroup')).toBeDefined();
    expect(screen.getByText('Channel')).toBeDefined();
  });

  it('keeps a failed search inline and retries the same query', async () => {
    bridge.searchContacts
      .mockResolvedValueOnce({ people: [ada], chats: [] })
      .mockRejectedValueOnce(new Error('The Search Could Not Be Read'))
      .mockResolvedValueOnce({ people: [bob], chats: [] });
    renderDialog();

    await screen.findByText('Ada');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people and chats' }), { target: { value: 'bo' } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The Search Could Not Be Read');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Bob')).toBeDefined();
    expect(bridge.searchContacts).toHaveBeenLastCalledWith({ query: 'bo', limit: 20 });
  });
});
