import { describe, expect, it } from 'vitest';
import {
  applyThreadDeleted,
  applyThreadEdit,
  applyThreadNewMessage,
  applyThreadRestored,
  applyThreadSentMessages,
  threadReachesLatest,
} from '../../apps/web/src/thread-state';
import type { ChatThread } from '../../apps/web/src/thread-state';
import type { ChatDto, MessageDto } from '../../apps/web/src/types';

const CHAT: ChatDto = {
  id: 1,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
  canDeleteMessages: true,
  presence: null,
};

function message(id: number, text = `message ${id}`, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id,
    chatId: 1,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000 + id,
    text,
    entities: [],
    reactions: [],
    service: false,
    media: null,
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

function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    chat: CHAT,
    messages: [message(1), message(2), message(3)],
    readInboxMaxId: 3,
    readOutboxMaxId: 0,
    unreadDividerId: null,
    focusMessageId: null,
    hasMoreOlder: true,
    windowEndId: 3,
    latestMessageId: 3,
    newMessageIds: new Set(),
    ...overrides,
  };
}

describe('thread cursors', () => {
  it('only reaches the latest once the window end has caught up', () => {
    expect(threadReachesLatest(thread({ windowEndId: 10, latestMessageId: 10 }))).toBe(true);
    expect(threadReachesLatest(thread({ windowEndId: 10, latestMessageId: 11 }))).toBe(false);
    // A thread with no window yet has nothing to page from; it only becomes a
    // backlog once the opening read lands.
    expect(threadReachesLatest(thread({ windowEndId: null, latestMessageId: 3 }))).toBe(true);
    expect(threadReachesLatest(thread({ latestMessageId: null }))).toBe(true);
  });
});

describe('live thread updates', () => {
  it('holds a new message back while the loaded range is behind', () => {
    const current = thread({ windowEndId: 3, latestMessageId: 10 });
    const next = applyThreadNewMessage(current, message(11));

    expect(next?.messages).toEqual(current.messages);
    expect(next?.windowEndId).toBe(3);
    expect(next?.latestMessageId).toBe(11);
    expect(next?.newMessageIds.size).toBe(0);
  });

  it('folds a new message in once the range has reached the newest one', () => {
    const current = thread({ windowEndId: 10, latestMessageId: 10 });
    const next = applyThreadNewMessage(current, message(11));

    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2, 3, 11]);
    expect(next?.windowEndId).toBe(11);
    expect(next?.latestMessageId).toBe(11);
    expect(next?.newMessageIds.has(11)).toBe(true);
  });

  it('folds a message that belongs inside the loaded window even while behind', () => {
    const current = thread({ windowEndId: 10, latestMessageId: 15, messages: [message(1), message(2), message(3)] });
    const next = applyThreadNewMessage(current, message(2, 'late copy'));

    expect(next?.messages.find((entry) => entry.id === 2)?.text).toBe('late copy');
    expect(next?.windowEndId).toBe(10);
    // An inside-window fold replaces an already-loaded row; it must not
    // re-animate an existing bubble.
    expect(next?.newMessageIds.size).toBe(0);
  });

  it('always shows a sent message, but leaves the contiguous end behind the gap', () => {
    const current = thread({ windowEndId: 3, latestMessageId: 10 });
    const next = applyThreadSentMessages(current, 1, [message(11, 'my reply', { outgoing: true })]);

    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2, 3, 11]);
    expect(next?.windowEndId).toBe(3);
    expect(next?.latestMessageId).toBe(11);
    expect(next?.newMessageIds.has(11)).toBe(true);
  });

  it('advances the contiguous end with a send made at the newest message', () => {
    const current = thread({ windowEndId: 10, latestMessageId: 10 });
    const next = applyThreadSentMessages(current, 1, [message(11, 'my reply', { outgoing: true })]);

    expect(next?.windowEndId).toBe(11);
    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2, 3, 11]);
    expect(next?.newMessageIds.has(11)).toBe(true);
  });

  it('does not re-animate a message the thread already held', () => {
    const current = thread({ windowEndId: 10, latestMessageId: 10 });
    const next = applyThreadSentMessages(current, 1, [message(3, 'again', { outgoing: true })]);

    expect(next?.newMessageIds.size).toBe(0);
  });

  it('marks neither held-back live messages nor edits as new', () => {
    const behind = thread({ windowEndId: 3, latestMessageId: 10 });
    expect(applyThreadNewMessage(behind, message(11))?.newMessageIds.size).toBe(0);
    expect(applyThreadEdit(behind, message(2, 'edited'))?.newMessageIds.size).toBe(0);
  });

  it('ignores an edit beyond the loaded window instead of creating a gap', () => {
    const current = thread({ windowEndId: 3, latestMessageId: 10 });
    const next = applyThreadEdit(current, message(12, 'edited out of range'));

    expect(next).toBe(current);
    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it('replaces an edited message inside the loaded window', () => {
    const current = thread({ windowEndId: 3, latestMessageId: 10 });
    const next = applyThreadEdit(current, message(2, 'edited'));

    expect(next?.messages.find((entry) => entry.id === 2)?.text).toBe('edited');
  });
});

describe('thread deletions', () => {
  it('drops the loaded rows and pulls the cursors off a deleted edge', () => {
    const current = thread({ messages: [message(1), message(2), message(3)], windowEndId: 3, latestMessageId: 3 });
    const next = applyThreadDeleted(current, 1, [2]);

    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 3]);
    expect(next?.windowEndId).toBe(3);
    expect(next?.latestMessageId).toBe(3);
  });

  it('moves the window end to what is left when it named a deleted message', () => {
    const current = thread({ messages: [message(1), message(2), message(3)], windowEndId: 3, latestMessageId: 3 });
    const next = applyThreadDeleted(current, 1, [3]);

    expect(next?.windowEndId).toBe(2);
    expect(next?.latestMessageId).toBe(2);
  });

  it('folds a peerless deletion by matching the loaded ids', () => {
    const current = thread({ messages: [message(1), message(2), message(3)] });
    const next = applyThreadDeleted(current, null, [1, 3]);

    expect(next?.messages.map((entry) => entry.id)).toEqual([2]);
  });

  it('leaves the thread alone for another chat, an unmatched id, or an empty list', () => {
    const current = thread();
    expect(applyThreadDeleted(current, 2, [1])).toBe(current);
    expect(applyThreadDeleted(current, null, [99])).toBe(current);
    expect(applyThreadDeleted(current, 1, [])).toBe(current);
    expect(applyThreadDeleted(null, 1, [1])).toBeNull();
  });

  it('forgets the unread divider, focus and animation of a deleted row', () => {
    const current = thread({
      messages: [message(1), message(2), message(3)],
      unreadDividerId: 2,
      focusMessageId: 2,
      newMessageIds: new Set([2, 3]),
    });
    const next = applyThreadDeleted(current, 1, [2]);

    expect(next?.unreadDividerId).toBeNull();
    expect(next?.focusMessageId).toBeNull();
    expect([...(next?.newMessageIds ?? [])]).toEqual([3]);
  });

  it('keeps the range when the deletion was beyond the loaded window', () => {
    const current = thread({ messages: [message(1), message(2)], windowEndId: 2, latestMessageId: 9 });
    const next = applyThreadDeleted(current, 1, [9]);

    expect(next?.latestMessageId).toBe(9);
    expect(next?.windowEndId).toBe(2);
  });

  it('restores a refused delete in order and without duplicating a redelivered row', () => {
    const current = thread({ messages: [message(1), message(2)] });
    const restored = applyThreadRestored(current, [message(3), message(2)]);

    expect(restored?.messages.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(restored?.windowEndId).toBe(3);
    expect(restored?.latestMessageId).toBe(3);
  });

  it('leaves the thread alone when the restore belongs elsewhere', () => {
    const current = thread();
    expect(applyThreadRestored(current, [message(1, 'x', { chatId: 2 })])).toBe(current);
    expect(applyThreadRestored(current, [])).toBe(current);
    expect(applyThreadRestored(null, [message(1)])).toBeNull();
  });
});
