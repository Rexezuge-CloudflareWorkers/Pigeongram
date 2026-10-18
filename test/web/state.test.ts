import { describe, expect, it } from 'vitest';
import { formatBytes, formatDay, formatListStamp, formatTime, initials, isSameDay, previewOf } from '../../pages/src/format';
import { applyEditedMessage, applyNewMessage, applyReadUpdate, findChatTitle, mergeMessages, replaceMessage } from '../../pages/src/state';
import type { DialogDto, MessageDto, MessageMediaDto } from '../../pages/src/types';

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

const PHOTO: MessageMediaDto = {
  kind: 'photo',
  fileName: null,
  mime: null,
  size: 1000,
  width: 320,
  height: 240,
  duration: null,
};

function message(overrides: Partial<MessageDto> & { id: number; chatId: number }): MessageDto {
  return {
    senderId: 1,
    senderName: 'Ada',
    outgoing: false,
    date: NOW,
    text: `message ${overrides.id}`,
    service: false,
    media: null,
    ...overrides,
  };
}

function dialog(id: number, overrides: Partial<DialogDto> = {}): DialogDto {
  return {
    chat: { id, kind: 'user', title: `Chat ${id}`, username: null, photo: null },
    lastMessage: null,
    unread: 0,
    pinned: false,
    muted: false,
    ...overrides,
  };
}

describe('chat-list state', () => {
  it('ignores messages for chats the list does not know', () => {
    const dialogs = [dialog(1), dialog(2)];
    expect(applyNewMessage(dialogs, message({ id: 1, chatId: 99 }), null)).toBe(dialogs);
  });

  it('moves a chat to the top of the unpinned block and bumps unread', () => {
    const dialogs = [dialog(1, { pinned: true }), dialog(2), dialog(3)];
    const incoming = message({ id: 5, chatId: 3, text: 'third!' });
    const next = applyNewMessage(dialogs, incoming, null);
    expect(next.map((entry) => entry.chat.id)).toEqual([1, 3, 2]);
    expect(next[1].unread).toBe(1);
    expect(next[1].lastMessage).toBe(incoming);
  });

  it('keeps pinned chats in place and does not bump the open chat or outgoing messages', () => {
    const dialogs = [dialog(1, { pinned: true, unread: 2 }), dialog(2)];
    const pinned = applyNewMessage(dialogs, message({ id: 6, chatId: 1 }), null);
    expect(pinned[0].chat.id).toBe(1);
    expect(pinned[0].unread).toBe(3);

    const active = applyNewMessage(dialogs, message({ id: 7, chatId: 2 }), 2);
    expect(active[1].unread).toBe(0);

    const outgoing = applyNewMessage(dialogs, message({ id: 8, chatId: 2, outgoing: true }), null);
    expect(outgoing[1].unread).toBe(0);
  });

  it('applies read updates and edited last messages', () => {
    const dialogs = [dialog(1, { unread: 5 }), dialog(2)];
    expect(applyReadUpdate(dialogs, 1, 0)[0].unread).toBe(0);

    const withLast = dialogs.map((entry) => (entry.chat.id === 1 ? { ...entry, lastMessage: message({ id: 9, chatId: 1 }) } : entry));
    const edited = applyEditedMessage(withLast, message({ id: 9, chatId: 1, text: 'edited' }));
    expect(edited[0].lastMessage?.text).toBe('edited');
    expect(edited[1].lastMessage).toBeNull();
  });

  it('finds chat titles by id', () => {
    expect(findChatTitle([dialog(4)], 4)).toBe('Chat 4');
    expect(findChatTitle([dialog(4)], 5)).toBeNull();
  });
});

describe('thread state', () => {
  it('merges batches by id, oldest first, with incoming values winning', () => {
    const existing = [message({ id: 2, chatId: 1, text: 'two' }), message({ id: 3, chatId: 1, text: 'three' })];
    const incoming = [message({ id: 1, chatId: 1, text: 'one' }), message({ id: 3, chatId: 1, text: 'three (edited)' })];
    expect(mergeMessages(existing, incoming).map((entry) => [entry.id, entry.text])).toEqual([
      [1, 'one'],
      [2, 'two'],
      [3, 'three (edited)'],
    ]);
  });

  it('replaces messages in place and appends unknown ones', () => {
    const messages = [message({ id: 1, chatId: 1 }), message({ id: 2, chatId: 1 })];
    const replaced = replaceMessage(messages, message({ id: 2, chatId: 1, text: 'new' }));
    expect(replaced[1].text).toBe('new');
    expect(replaced.length).toBe(2);
    expect(replaceMessage(messages, message({ id: 3, chatId: 1 })).length).toBe(3);
  });
});

describe('formatting helpers', () => {
  it('formats times of day', () => {
    expect(formatTime(NOW)).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formats chat-list stamps', () => {
    expect(formatListStamp(NOW - 10_000, NOW)).toBe('now');
    expect(formatListStamp(NOW - 5 * 60_000, NOW)).toBe('5m');
    expect(formatListStamp(NOW - 3 * 3_600_000, NOW)).toBe('3h');
    const old = formatListStamp(NOW - 5 * 86_400_000, NOW);
    expect(old).not.toMatch(/^\d+[mh]$/);
    expect(old.length).toBeGreaterThan(0);
  });

  it('labels days relative to today', () => {
    expect(formatDay(NOW, NOW)).toBe('Today');
    expect(formatDay(NOW - 86_400_000, NOW)).toBe('Yesterday');
    expect(formatDay(NOW - 10 * 86_400_000, NOW).length).toBeGreaterThan(0);
    expect(isSameDay(NOW, NOW + 3_600_000)).toBe(true);
    expect(isSameDay(NOW, NOW + 86_400_000)).toBe(false);
  });

  it('derives initials and previews', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Telegram')).toBe('T');
    expect(initials(' '.repeat(3))).toBe('?');
    expect(previewOf('hello', null)).toBe('hello');
    expect(previewOf('caption', PHOTO)).toBe('caption');
    expect(previewOf('', PHOTO)).toBe('Photo');
    expect(previewOf('', { ...PHOTO, kind: 'voice' })).toBe('Voice message');
    expect(previewOf('', null)).toBe('—');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1024 * 1024 * 1024).length).toBeGreaterThan(0);
  });
});
