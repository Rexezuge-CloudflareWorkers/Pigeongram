import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatList } from '../../apps/web/src/components/ChatList';
import type { ChatDto, DialogDto, DialogMessageDto, MessageDto, PresenceDto } from '../../apps/web/src/types';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function chat(id: number, overrides: Partial<ChatDto> = {}): ChatDto {
  return {
    id,
    kind: 'user',
    title: `Chat ${id}`,
    username: null,
    photo: null,
    canSendMessages: true,
    presence: null,
    ...overrides,
  };
}

function dialog(chatDto: ChatDto, overrides: Partial<DialogDto> = {}): DialogDto {
  return {
    chat: chatDto,
    lastMessage: null,
    unread: 0,
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
    archived: false,
    ...overrides,
  };
}

function message(text: string): MessageDto {
  return {
    id: 10,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  };
}

/**
The chat list's view of a message: the list renders a preview, not a thread.
*/
function dialogMessage(source: MessageDto): DialogMessageDto {
  return {
    id: source.id,
    date: source.date,
    text: source.text,
    media: source.media,
    poll: source.poll,
    outgoing: source.outgoing,
    service: source.service,
    groupedId: source.groupedId,
  };
}

function renderList(dialogs: DialogDto[]): void {
  render(<ChatList dialogs={dialogs} activeChatId={null} loading={false} onSelect={() => {}} />);
}

function renderEmpty(emptyLabel?: string): void {
  render(<ChatList dialogs={[]} activeChatId={null} loading={false} onSelect={() => {}} emptyLabel={emptyLabel} />);
}

/**
The row a chat's title belongs to.
*/
function rowIn(name: string): HTMLElement {
  const row = screen.getByText(name).closest('button');
  if (!row) throw new Error(`no row for ${name}`);
  return row as HTMLElement;
}

function badgeIn(name: string): Element | null {
  const row = screen.getByText(name).closest('button');
  return row?.querySelector('[data-status="online"]') ?? null;
}

describe('ChatList empty state', () => {
  it('says that the account has no chats', () => {
    renderEmpty();
    expect(screen.getByText('No chats yet.')).toBeDefined();
  });

  it('says so in the wording of the archive', () => {
    // An empty archive is not an account without chats.
    renderEmpty('No archived chats.');
    expect(screen.getByText('No archived chats.')).toBeDefined();
  });
});

describe('ChatList presence', () => {
  it('marks an online peer with a green badge on the avatar', () => {
    const presence: PresenceDto = { status: 'online', lastSeenAt: null };
    renderList([dialog(chat(1, { title: 'Bob', presence }))]);

    const badge = badgeIn('Bob');
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain('bg-online');
    // The badge is decorative: the peer's name carries the meaning.
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves an offline peer unmarked', () => {
    renderList([dialog(chat(1, { title: 'Bob', presence: { status: 'offline', lastSeenAt: 1_700_000_000_000 } }))]);

    expect(badgeIn('Bob')).toBeNull();
  });

  it('leaves a peer with no presence unmarked', () => {
    renderList([dialog(chat(1, { title: 'Bob' }))]);

    expect(badgeIn('Bob')).toBeNull();
  });

  it('marks every online peer in the list', () => {
    renderList([
      dialog(chat(1, { title: 'Bob', presence: { status: 'online', lastSeenAt: null } })),
      dialog(chat(2, { title: 'Carol' })),
      dialog(chat(3, { title: 'Dave', presence: { status: 'online', lastSeenAt: null } })),
    ]);

    expect(badgeIn('Bob')).not.toBeNull();
    expect(badgeIn('Carol')).toBeNull();
    expect(badgeIn('Dave')).not.toBeNull();
  });

  it('never marks a group or a bot, which the bridge never gives a presence', () => {
    // The bridge sends no presence for a group or a bot, so their rows carry
    // none and stay unmarked.
    renderList([dialog(chat(-10, { title: 'Team', kind: 'supergroup' })), dialog(chat(5, { title: 'Helper', kind: 'bot' }))]);

    expect(badgeIn('Team')).toBeNull();
    expect(badgeIn('Helper')).toBeNull();
  });
});

describe('ChatList pin marker', () => {
  function pinIn(name: string): Element | null {
    return rowIn(name).querySelector('[data-pin]');
  }

  function countIn(name: string): Element | null {
    return rowIn(name).querySelector('.badge');
  }

  it('puts the pin in the count slot of a chat with nothing unread', () => {
    renderList([dialog(chat(1, { title: 'Bob' }), { pinned: true })]);

    expect(pinIn('Bob')).not.toBeNull();
    expect(pinIn('Bob')?.querySelector('svg[data-icon="pin"]')).not.toBeNull();
    expect(countIn('Bob')).toBeNull();
  });

  it('drops the pin when a message arrives: the count has priority', () => {
    renderList([dialog(chat(1, { title: 'Bob' }), { pinned: true, unread: 3 })]);

    expect(countIn('Bob')?.textContent).toBe('3');
    expect(pinIn('Bob')).toBeNull();
  });

  it('leaves an unpinned chat with neither the pin nor a count', () => {
    renderList([dialog(chat(1, { title: 'Bob' }))]);

    expect(pinIn('Bob')).toBeNull();
    expect(countIn('Bob')).toBeNull();
  });

  it('keeps the pin out of the preview text', () => {
    renderList([dialog(chat(1, { title: 'Bob' }), { pinned: true, lastMessage: dialogMessage(message('see you')) })]);

    const preview = rowIn('Bob').querySelector('.chat-preview');
    expect(preview?.textContent).toBe('see you');
  });

  it('marks the pin as decorative, so the preview carries no stray glyph', () => {
    renderList([dialog(chat(1, { title: 'Bob' }), { pinned: true })]);

    expect(pinIn('Bob')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ChatList context menu', () => {
  function renderWithHandlers(dialogs: DialogDto[], handlers: { onSelect?: () => void; onMarkRead?: () => void } = {}): void {
    render(
      <ChatList
        dialogs={dialogs}
        activeChatId={null}
        loading={false}
        onSelect={handlers.onSelect ?? (() => {})}
        onMarkRead={handlers.onMarkRead}
      />,
    );
  }

  it('opens Chat actions on a right-click and marks the chat read', () => {
    const onMarkRead = vi.fn();
    renderWithHandlers([dialog(chat(1, { title: 'Bob' }), { unread: 3 })], { onMarkRead });

    fireEvent.contextMenu(rowIn('Bob'), { clientX: 20, clientY: 30 });
    const menu = screen.getByRole('menu', { name: 'Chat actions' });
    const item = within(menu).getByRole('menuitem', { name: 'Mark As Read' });
    expect((item as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(item);

    expect(onMarkRead).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('menu', { name: 'Chat actions' })).toBeNull();
  });

  it('offers Mark As Read disabled for a chat with nothing unread', () => {
    const onMarkRead = vi.fn();
    renderWithHandlers([dialog(chat(1, { title: 'Bob' }), { unread: 0 })], { onMarkRead });

    fireEvent.contextMenu(rowIn('Bob'), { clientX: 20, clientY: 30 });
    const item = within(screen.getByRole('menu', { name: 'Chat actions' })).getByRole('menuitem', { name: 'Mark As Read' });
    expect((item as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(item);

    expect(onMarkRead).not.toHaveBeenCalled();
  });

  it('opens the same menu with a 500 ms touch long press', () => {
    vi.useFakeTimers();
    renderWithHandlers([dialog(chat(1, { title: 'Bob' }), { unread: 3 })]);

    fireEvent.pointerDown(rowIn('Bob'), { pointerType: 'touch', clientX: 20, clientY: 30 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByRole('menu', { name: 'Chat actions' })).toBeDefined();
  });

  it('cancels a long press that drifts past the slop', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    renderWithHandlers([dialog(chat(1, { title: 'Bob' }), { unread: 3 })], { onSelect });

    fireEvent.pointerDown(rowIn('Bob'), { pointerType: 'touch', clientX: 20, clientY: 30 });
    fireEvent.pointerMove(rowIn('Bob'), { pointerType: 'touch', clientX: 31, clientY: 30 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByRole('menu', { name: 'Chat actions' })).toBeNull();

    // The press turned into a scroll, so the tap still opens the chat.
    fireEvent.pointerUp(rowIn('Bob'));
    fireEvent.click(rowIn('Bob'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not open the chat when the finger lifts after a long press', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    renderWithHandlers([dialog(chat(1, { title: 'Bob' }), { unread: 3 })], { onSelect });

    fireEvent.pointerDown(rowIn('Bob'), { pointerType: 'touch', clientX: 20, clientY: 30 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(rowIn('Bob'));
    fireEvent.click(rowIn('Bob'));

    expect(screen.getByRole('menu', { name: 'Chat actions' })).toBeDefined();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
