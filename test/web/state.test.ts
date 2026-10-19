import { describe, expect, it } from 'vitest';
import { formatBytes, formatDay, formatListStamp, formatTime, initials, isSameDay, previewOf } from '../../pages/src/format';
import {
  applyEditedMessage,
  applyNewMessage,
  applyReactionUpdate,
  applyReadThrough,
  applyReadUpdate,
  findChatTitle,
  mergeMessages,
  reactionKey,
  replaceMessage,
  toggleReaction,
  updateThread,
} from '../../pages/src/state';
import { firstUnread, readWatermark } from '../../pages/src/reading';
import type { ChatDto, DialogDto, MessageDto, MessageMediaDto } from '../../pages/src/types';

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
    groupedId: null,
    senderId: 1,
    senderName: 'Ada',
    outgoing: false,
    date: NOW,
    text: `message ${overrides.id}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    reply: null,
    comments: null,
    ...overrides,
  };
}

function chat(id: number): ChatDto {
  return { id, kind: 'user', title: `Chat ${id}`, username: null, photo: null, canSendMessages: true };
}

function dialog(id: number, overrides: Partial<DialogDto> = {}): DialogDto {
  return {
    chat: chat(id),
    lastMessage: null,
    unread: 0,
    readInboxMaxId: 0,
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
    const read = applyReadUpdate(dialogs, 1, 0, 7);
    expect(read[0].unread).toBe(0);
    expect(read[0].readInboxMaxId).toBe(7);
    // A stale read update must not rewind the watermark reading stopped at.
    expect(applyReadUpdate(read, 1, 4, 3)[0].readInboxMaxId).toBe(7);

    const withLast = dialogs.map((entry) => (entry.chat.id === 1 ? { ...entry, lastMessage: message({ id: 9, chatId: 1 }) } : entry));
    const edited = applyEditedMessage(withLast, message({ id: 9, chatId: 1, text: 'edited' }));
    expect(edited[0].lastMessage?.text).toBe('edited');
    expect(edited[1].lastMessage).toBeNull();
  });

  it('advances the watermark through what the viewport read, incoming only', () => {
    const dialogs = [dialog(1, { unread: 3, readInboxMaxId: 6 }), dialog(2, { unread: 1 })];
    const messages = [
      message({ id: 7, chatId: 1 }),
      message({ id: 8, chatId: 1, outgoing: true }),
      message({ id: 9, chatId: 1 }),
      message({ id: 10, chatId: 1 }),
    ];

    const through9 = applyReadThrough(dialogs, 1, 9, messages);
    expect(through9[0]).toMatchObject({ readInboxMaxId: 9, unread: 1 });
    expect(through9[1]).toBe(dialogs[1]);

    // Reading on clears the badge; the outgoing message in between counts for
    // nothing.
    expect(applyReadThrough(through9, 1, 10, messages)[0]).toMatchObject({ readInboxMaxId: 10, unread: 0 });
    // A watermark behind the dialog's own leaves it untouched.
    expect(applyReadThrough(through9, 1, 7, messages)[0]).toBe(through9[0]);
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

  it('applies thread updates only while the thread belongs to the chat', () => {
    const thread = { chat: chat(1), messages: [message({ id: 1, chatId: 1 })], readInboxMaxId: 5 };
    const foreign = updateThread(thread, 2, () => [message({ id: 2, chatId: 2 })]);
    expect(foreign).toBe(thread);

    const next = updateThread(thread, 1, (messages) => mergeMessages(messages, [message({ id: 2, chatId: 1 })]));
    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2]);
    // The thread's read watermark rides along with its messages.
    expect(next?.readInboxMaxId).toBe(5);
  });

  it('keeps the thread value when nothing changes or no thread is open', () => {
    const thread = { chat: chat(1), messages: [message({ id: 1, chatId: 1 })], readInboxMaxId: 0 };
    expect(updateThread(thread, 1, (messages) => messages)).toBe(thread);
    expect(updateThread(null, 1, (messages) => messages)).toBeNull();
  });
});

describe('reaction state', () => {
  it('identifies reactions by emoji or custom document id', () => {
    expect(reactionKey({ emoji: '👍', customEmojiId: null, count: 1, chosen: false })).toBe('👍');
    expect(reactionKey({ emoji: null, customEmojiId: '42', count: 1, chosen: false })).toBe('custom:42');
  });

  it('applies reaction updates only to the matching loaded message', () => {
    const messages = [message({ id: 1, chatId: 1 }), message({ id: 2, chatId: 1 }), message({ id: 1, chatId: 2 })];
    const reactions = [{ emoji: '🔥', customEmojiId: null, count: 2, chosen: false }];
    const next = applyReactionUpdate(messages, 1, 1, reactions);
    expect(next[0].reactions).toBe(reactions);
    expect(next[1].reactions).toEqual([]);
    expect(next[2].reactions).toEqual([]);
  });

  it('toggles a reaction on, clearing the previously chosen one', () => {
    const thumbs = { emoji: '👍', customEmojiId: null, count: 1, chosen: false };
    const fire = { emoji: '🔥', customEmojiId: null, count: 2, chosen: true };
    expect(toggleReaction([thumbs, fire], thumbs)).toEqual([
      { emoji: '👍', customEmojiId: null, count: 2, chosen: true },
      { emoji: '🔥', customEmojiId: null, count: 1, chosen: false },
    ]);
  });

  it('toggles a reaction off and drops aggregates that reach zero', () => {
    const chosen = { emoji: '👍', customEmojiId: null, count: 2, chosen: true };
    expect(toggleReaction([chosen], chosen)).toEqual([{ emoji: '👍', customEmojiId: null, count: 1, chosen: false }]);

    const last = { emoji: '👍', customEmojiId: null, count: 1, chosen: true };
    expect(toggleReaction([last], last)).toEqual([]);
  });

  it('adds a reaction that is not in the list yet', () => {
    expect(toggleReaction([], { emoji: '❤', customEmojiId: null, count: 0, chosen: false })).toEqual([
      { emoji: '❤', customEmojiId: null, count: 1, chosen: true },
    ]);
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

describe('unread reading', () => {
  const thread = [
    message({ id: 6, chatId: 1 }),
    message({ id: 7, chatId: 1, outgoing: true }),
    message({ id: 8, chatId: 1 }),
    message({ id: 9, chatId: 1 }),
  ];

  it('anchors on the first incoming message after the watermark', () => {
    expect(firstUnread(thread, 6)?.id).toBe(8);
    expect(firstUnread(thread, 8)?.id).toBe(9);
    expect(firstUnread(thread, 9)).toBeNull();
    expect(firstUnread([], 0)).toBeNull();
  });

  it('measures the read watermark from the visible ids or the bottom', () => {
    expect(readWatermark(thread, new Set([6]), false)).toBe(6);
    // Outgoing messages never carry the watermark; the highest visible
    // incoming one does.
    expect(readWatermark(thread, new Set([6, 7, 8]), false)).toBe(8);
    expect(readWatermark(thread, new Set(), false)).toBeNull();
    // Pinned to the bottom, everything is on screen.
    expect(readWatermark(thread, new Set(), true)).toBe(9);
    expect(readWatermark([], new Set(), true)).toBeNull();
  });
});
