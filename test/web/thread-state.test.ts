import { describe, expect, it } from 'vitest';
import { applyThreadEdit, applyThreadNewMessage, applyThreadSentMessages, threadReachesLatest } from '../../apps/web/src/thread-state';
import type { ChatThread } from '../../apps/web/src/thread-state';
import type { ChatDto, MessageDto } from '../../apps/web/src/types';

const CHAT: ChatDto = {
  id: 1,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
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
    poll: null,
    markup: null,
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
  });

  it('folds a new message in once the range has reached the newest one', () => {
    const current = thread({ windowEndId: 10, latestMessageId: 10 });
    const next = applyThreadNewMessage(current, message(11));

    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2, 3, 11]);
    expect(next?.windowEndId).toBe(11);
    expect(next?.latestMessageId).toBe(11);
  });

  it('folds a message that belongs inside the loaded window even while behind', () => {
    const current = thread({ windowEndId: 10, latestMessageId: 15, messages: [message(1), message(2), message(3)] });
    const next = applyThreadNewMessage(current, message(2, 'late copy'));

    expect(next?.messages.find((entry) => entry.id === 2)?.text).toBe('late copy');
    expect(next?.windowEndId).toBe(10);
  });

  it('always shows a sent message, but leaves the contiguous end behind the gap', () => {
    const current = thread({ windowEndId: 3, latestMessageId: 10 });
    const next = applyThreadSentMessages(current, 1, [message(11, 'my reply', { outgoing: true })]);

    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2, 3, 11]);
    expect(next?.windowEndId).toBe(3);
    expect(next?.latestMessageId).toBe(11);
  });

  it('advances the contiguous end with a send made at the newest message', () => {
    const current = thread({ windowEndId: 10, latestMessageId: 10 });
    const next = applyThreadSentMessages(current, 1, [message(11, 'my reply', { outgoing: true })]);

    expect(next?.windowEndId).toBe(11);
    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2, 3, 11]);
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
