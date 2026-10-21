import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatList } from '../../pages/src/components/ChatList';
import type { ChatDto, DialogDto, MessageDto, PresenceDto } from '../../pages/src/types';

afterEach(cleanup);

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

function renderList(dialogs: DialogDto[]): void {
  render(<ChatList dialogs={dialogs} activeChatId={null} loading={false} onSelect={() => {}} />);
}

function badgeIn(name: string): Element | null {
  const row = screen.getByText(name).closest('button');
  return row?.querySelector('[data-status="online"]') ?? null;
}

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
  function rowIn(name: string): HTMLElement {
    const row = screen.getByText(name).closest('button');
    if (!row) throw new Error(`no row for ${name}`);
    return row as HTMLElement;
  }

  function pinIn(name: string): Element | null {
    return rowIn(name).querySelector('[data-pin]');
  }

  function countIn(name: string): Element | null {
    return rowIn(name).querySelector('.badge');
  }

  it('puts the pin in the count slot of a chat with nothing unread', () => {
    renderList([dialog(chat(1, { title: 'Bob' }), { pinned: true })]);

    expect(pinIn('Bob')).not.toBeNull();
    expect(pinIn('Bob')?.textContent).toBe('📌');
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
    renderList([dialog(chat(1, { title: 'Bob' }), { pinned: true, lastMessage: message('see you') })]);

    const preview = rowIn('Bob').querySelector('.chat-preview');
    expect(preview?.textContent).toBe('see you');
  });

  it('marks the pin as decorative, so the preview carries no stray glyph', () => {
    renderList([dialog(chat(1, { title: 'Bob' }), { pinned: true })]);

    expect(pinIn('Bob')?.getAttribute('aria-hidden')).toBe('true');
  });
});
