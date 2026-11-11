import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageRow } from '../../apps/web/src/components/MessageRow';
import type { ChatDto, MessageDto, MessageMediaDto, MessagePollDto } from '../../apps/web/src/types';

afterEach(cleanup);

const chat: ChatDto = {
  id: 2,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
  canDeleteMessages: true,
  presence: null,
};

function media(overrides: Partial<MessageMediaDto> = {}): MessageMediaDto {
  return {
    kind: 'photo',
    fileName: null,
    mime: 'image/jpeg',
    size: 1024,
    width: 320,
    height: 240,
    duration: null,
    ...overrides,
  };
}

function message(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 10,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text: '',
    entities: [],
    reactions: [],
    service: false,
    media: media(),
    webPage: null,
    poll: null,
    markup: null,
    replyKeyboard: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
    ...overrides,
  };
}

function renderRow(group: MessageDto[], overrides: Partial<Parameters<typeof MessageRow>[0]> = {}) {
  return render(<MessageRow group={group} chat={chat} original={null} onOpenMedia={vi.fn()} {...overrides} />);
}

describe('MessageRow newness', () => {
  it('renders without the entrance animation unless the message is marked new', () => {
    const { container } = renderRow([message()]);
    expect((container.querySelector('[data-message-id="10"]') as HTMLElement | null)?.dataset.new).toBe('false');
  });

  it('animates only when the message arrived after the window landed', () => {
    const { container } = renderRow([message()], { isNew: true });
    expect((container.querySelector('[data-message-id="10"]') as HTMLElement | null)?.dataset.new).toBe('true');
  });
});

describe('MessageRow bare media rendering', () => {
  it('renders a plain single photo without bubble chrome and keeps hover meta in the DOM', () => {
    const { container } = renderRow([message()]);
    const row = container.querySelector('[data-message-id="10"]');
    expect(row?.classList.contains('message')).toBe(true);
    expect(row?.classList.contains('bare')).toBe(true);
    expect(row?.querySelector('.photo')).not.toBeNull();
    expect(row?.querySelector('.meta')).not.toBeNull();
    expect(row?.querySelector('.sender')).toBeNull();
    expect(row?.querySelector('.forward-origin')).toBeNull();
    expect(row?.querySelector('.reply-quote')).toBeNull();
    expect(row?.querySelector('.reactions')).toBeNull();
  });

  it.each([
    ['photo', { kind: 'photo', mime: 'image/jpeg', fileName: null }],
    ['video', { kind: 'video', mime: 'video/mp4', fileName: 'clip.mp4', duration: 3 }],
    ['animation', { kind: 'animation', mime: 'video/mp4', fileName: 'loop.mp4', duration: 2 }],
    ['document', { kind: 'document', mime: 'application/pdf', fileName: 'notes.pdf', width: null, height: null }],
    ['audio', { kind: 'audio', mime: 'audio/mpeg', fileName: 'song.mp3', width: null, height: null, duration: 120 }],
    ['voice', { kind: 'voice', mime: 'audio/ogg', fileName: null, width: null, height: null, duration: 4 }],
    ['sticker', { kind: 'sticker', mime: 'image/webp', fileName: 'sticker.webp' }],
  ] as const)('renders a plain single %s message as bare', (_label, override) => {
    const { container } = renderRow([message({ media: media(override) })]);
    expect(container.querySelector('[data-message-id="10"]')?.classList.contains('bare')).toBe(true);
  });

  it('keeps the bubble when a single media message has a caption', () => {
    const { container } = renderRow([message({ text: 'Look at this' })]);
    const row = container.querySelector('[data-message-id="10"]');
    expect(row?.classList.contains('bare')).toBe(false);
    expect(screen.getByText('Look at this')).not.toBeNull();
    expect(row?.querySelector('.meta')).not.toBeNull();
  });

  it('keeps the bubble when a single media message is a reply', () => {
    const { container } = renderRow([
      message({
        reply: {
          origin: 'same_chat',
          messageId: 5,
          chatId: null,
          senderName: 'Bob',
          outgoing: false,
          date: null,
          text: 'Earlier',
          entities: [],
          mediaKind: null,
          quote: false,
        },
      }),
    ]);
    expect(container.querySelector('[data-message-id="10"]')?.classList.contains('bare')).toBe(false);
  });

  it('keeps the bubble when a single media message is forwarded', () => {
    const { container } = renderRow([
      message({
        forward: {
          senderId: null,
          senderName: 'News',
          senderUsername: null,
          date: 1_700_000_000_000,
          fromChatId: null,
          fromMessageId: null,
          signature: null,
        },
      }),
    ]);
    expect(container.querySelector('[data-message-id="10"]')?.classList.contains('bare')).toBe(false);
  });

  it('keeps the bubble when a single media message has reactions', () => {
    const { container } = renderRow([message({ reactions: [{ emoji: '👍', customEmojiId: null, count: 1, chosen: false }] })]);
    expect(container.querySelector('[data-message-id="10"]')?.classList.contains('bare')).toBe(false);
  });

  it('keeps the bubble when a sender avatar would render', () => {
    const groupChat: ChatDto = { ...chat, id: 4, kind: 'supergroup', title: 'Team' };
    const { container } = renderRow([message({ senderPhoto: 'p1' })], { chat: groupChat, showAvatar: true });
    expect(container.querySelector('[data-message-id="10"]')?.classList.contains('bare')).toBe(false);
  });

  it('keeps the bubble when the sender name is shown', () => {
    const groupChat: ChatDto = { ...chat, id: 4, kind: 'supergroup', title: 'Team' };
    const { container } = renderRow([message()], { chat: groupChat });
    expect(container.querySelector('[data-message-id="10"]')?.classList.contains('bare')).toBe(false);
  });

  it('keeps albums bubbled', () => {
    const { container } = renderRow([
      message({ id: 10, groupedId: 'g1' }),
      message({ id: 11, groupedId: 'g1', media: media({ kind: 'photo' }) }),
    ]);
    expect(container.querySelector('[data-message-id="10"]')?.classList.contains('bare')).toBe(false);
  });

  it('keeps polls bubbled', () => {
    const poll: MessagePollDto = {
      id: 'p1',
      question: 'Q?',
      answers: [{ text: 'A', voters: 0, chosen: false, correct: null }],
      totalVoters: 0,
      closed: false,
      quiz: false,
      multiple: false,
      revotingDisabled: false,
      hideResultsUntilClose: false,
      solution: null,
    };
    const { container } = renderRow([message({ media: null, poll })]);
    expect(container.querySelector('[data-message-id="10"]')?.classList.contains('bare')).toBe(false);
  });

  it('preserves context menu and double-click reply on a bare message', () => {
    const onReply = vi.fn();
    const { container } = renderRow([message()], { onReply });
    const row = container.querySelector('[data-message-id="10"]') as HTMLElement;
    fireEvent.doubleClick(row);
    expect(onReply).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(screen.getByRole('menu', { name: 'Message actions' })).not.toBeNull();
  });
});

describe('MessageRow delete affordance', () => {
  function openMenu(row: HTMLElement): void {
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  }

  it('offers Delete on the account’s own message and hands over the display group', () => {
    const onDelete = vi.fn();
    const own = message({ id: 10, outgoing: true });
    const { container } = renderRow([own], { onDelete });

    openMenu(container.querySelector('[data-message-id="10"]') as HTMLElement);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledWith([own]);
  });

  it('withholds Delete from someone else’s message without the moderation right', () => {
    const { container } = renderRow([message()], { chat: { ...chat, canDeleteMessages: false }, onDelete: vi.fn() });

    openMenu(container.querySelector('[data-message-id="10"]') as HTMLElement);

    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('offers Delete on someone else’s message when the chat allows it', () => {
    const { container } = renderRow([message()], {
      chat: { ...chat, kind: 'supergroup', canDeleteMessages: true },
      onDelete: vi.fn(),
    });

    openMenu(container.querySelector('[data-message-id="10"]') as HTMLElement);

    expect(screen.getByRole('menuitem', { name: 'Delete' })).not.toBeNull();
  });

  it('lets a screen with narrower rights withhold other people’s messages', () => {
    const { container } = renderRow([message()], {
      chat: { ...chat, kind: 'supergroup', canDeleteMessages: true },
      onDelete: vi.fn(),
      canDeleteOthers: false,
    });

    openMenu(container.querySelector('[data-message-id="10"]') as HTMLElement);

    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('never offers Delete for a service message', () => {
    const { container } = renderRow([message({ outgoing: true, service: true, media: null, text: '' })], { onDelete: vi.fn() });

    openMenu(container.querySelector('[data-message-id="10"]') as HTMLElement);

    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });
});
