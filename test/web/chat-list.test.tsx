import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatList } from '../../pages/src/components/ChatList';
import type { ChatDto, DialogDto, PresenceDto } from '../../pages/src/types';

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

function dialog(chatDto: ChatDto): DialogDto {
  return {
    chat: chatDto,
    lastMessage: null,
    unread: 0,
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
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
