import { describe, expect, it } from 'vitest';
import { cachedOpen, mergeCacheRefresh, THREAD_CACHE_LIMIT, THREAD_CACHE_TTL_MS, ThreadCache } from '../../apps/web/src/thread-cache';
import type { ChatThread } from '../../apps/web/src/thread-state';
import type { ChatDto, DialogDto, MessageDto } from '../../apps/web/src/types';

const CHAT: ChatDto = {
  id: 1,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
  presence: null,
};

function message(id: number, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id,
    chatId: 1,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000 + id,
    text: `message ${id}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
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
    messages: Array.from({ length: 20 }, (_, index) => message(index + 1)),
    readInboxMaxId: 20,
    readOutboxMaxId: 0,
    unreadDividerId: null,
    focusMessageId: null,
    hasMoreOlder: true,
    windowEndId: 20,
    latestMessageId: 20,
    ...overrides,
  };
}

function dialog(overrides: Partial<DialogDto> = {}): DialogDto {
  return {
    chat: CHAT,
    lastMessage: {
      id: 20,
      date: 1_700_000_000_020,
      text: 'message 20',
      media: null,
      poll: null,
      outgoing: false,
      service: false,
      groupedId: null,
    },
    unread: 0,
    readInboxMaxId: 20,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
    archived: false,
    ...overrides,
  };
}

describe('thread cache', () => {
  it('keeps the most recent threads and evicts the least recently used', () => {
    const cache = new ThreadCache();
    const now = 1000;
    cache.set(thread({ chat: { ...CHAT, id: 1 } }), now);
    cache.set(thread({ chat: { ...CHAT, id: 2 }, messages: [message(1, { chatId: 2 })] }), now);
    cache.set(thread({ chat: { ...CHAT, id: 3 }, messages: [message(1, { chatId: 3 })] }), now);
    expect(THREAD_CACHE_LIMIT).toBe(3);

    // A read moves the entry to the recent end of the LRU.
    expect(cache.get(1, now)).not.toBeNull();
    cache.set(thread({ chat: { ...CHAT, id: 4 }, messages: [message(1, { chatId: 4 })] }), now);

    expect(cache.get(2, now)).toBeNull();
    expect(cache.get(1, now)).not.toBeNull();
    expect(cache.get(3, now)).not.toBeNull();
    expect(cache.get(4, now)).not.toBeNull();
  });

  it('expires an entry after the TTL', () => {
    const cache = new ThreadCache();
    const now = 1000;
    cache.set(thread(), now);

    expect(cache.get(1, now + THREAD_CACHE_TTL_MS)).not.toBeNull();
    expect(cache.get(1, now + THREAD_CACHE_TTL_MS + 1)).toBeNull();
  });

  it('only keeps a thread that reaches the newest message with no focus anchor', () => {
    const cache = new ThreadCache();
    cache.set(thread({ messages: [] }), 1000);
    expect(cache.get(1, 1000)).toBeNull();

    cache.set(thread({ windowEndId: null }), 1000);
    expect(cache.get(1, 1000)).toBeNull();

    cache.set(thread({ focusMessageId: 18 }), 1000);
    expect(cache.get(1, 1000)).toBeNull();

    // A window behind a backlog is not the chat's newest page.
    cache.set(thread({ windowEndId: 20, latestMessageId: 21 }), 1000);
    expect(cache.get(1, 1000)).toBeNull();

    cache.set(thread(), 1000);
    expect(cache.get(1, 1000)).not.toBeNull();
  });
});

describe('cached open', () => {
  it('paints a plain reopen with the dialog’s current chat and watermarks', () => {
    const higher = { ...CHAT, title: 'Bobby' };
    const painted = cachedOpen(thread({ readInboxMaxId: 18 }), dialog({ chat: higher, readInboxMaxId: 20, readOutboxMaxId: 19 }));

    expect(painted?.chat.title).toBe('Bobby');
    expect(painted?.readInboxMaxId).toBe(20);
    expect(painted?.readOutboxMaxId).toBe(19);
    expect(painted?.unreadDividerId).toBeNull();
    expect(painted?.focusMessageId).toBeNull();
  });

  it('refuses a chat with unread messages or a window that is a page behind', () => {
    expect(cachedOpen(thread(), dialog({ unread: 1 }))).toBeNull();
    expect(cachedOpen(thread(), dialog({ lastMessage: { ...dialog().lastMessage!, id: 41 } }))).toBeNull();
    // Exactly one opening page of new messages is still contiguous.
    expect(cachedOpen(thread(), dialog({ lastMessage: { ...dialog().lastMessage!, id: 40 } }))).not.toBeNull();
  });

  it('refuses another chat’s thread and a dialog behind the cached newest', () => {
    expect(cachedOpen(thread({ chat: { ...CHAT, id: 2 } }), dialog())).toBeNull();
    expect(cachedOpen(thread({ latestMessageId: 20 }), dialog({ lastMessage: { ...dialog().lastMessage!, id: 19 } }))).toBeNull();
    expect(cachedOpen(null, dialog())).toBeNull();
  });

  it('carries the dialog’s newest id while the painted window is behind it', () => {
    const painted = cachedOpen(thread({ latestMessageId: 20 }), dialog({ lastMessage: { ...dialog().lastMessage!, id: 40 } }));

    expect(painted?.latestMessageId).toBe(40);
    expect(painted?.windowEndId).toBe(20);
  });

  it('re-seeds the divider from the watermark the reopen carries', () => {
    const painted = cachedOpen(thread({ readInboxMaxId: 15 }), dialog({ readInboxMaxId: 15 }));
    expect(painted?.unreadDividerId).toBe(16);
  });
});

describe('cache refresh', () => {
  it('extends the cached range when the fresh page overlaps it', () => {
    const current = thread();
    const fresh = Array.from({ length: 11 }, (_, index) => message(index + 15));
    const next = mergeCacheRefresh(current, fresh, dialog({ lastMessage: { ...dialog().lastMessage!, id: 25 } }), 15);

    expect(next.messages.map((entry) => entry.id)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    expect(next.windowEndId).toBe(25);
    expect(next.latestMessageId).toBe(25);
    expect(next.hasMoreOlder).toBe(true);
    expect(next.unreadDividerId).toBe(16);
  });

  it('drops the cached window across a gap and keeps only what is newer than the page', () => {
    const current = thread({
      messages: [...Array.from({ length: 20 }, (_, index) => message(index + 1)), message(45)],
      windowEndId: 20,
      latestMessageId: 45,
    });
    const fresh = Array.from({ length: 11 }, (_, index) => message(index + 30));
    const next = mergeCacheRefresh(current, fresh, dialog({ lastMessage: { ...dialog().lastMessage!, id: 45 } }), 20);

    expect(next.messages.map((entry) => entry.id)).toEqual([...Array.from({ length: 11 }, (_, index) => index + 30), 45]);
    expect(next.messages.some((entry) => entry.id < 30)).toBe(false);
    expect(next.hasMoreOlder).toBe(false);
    expect(next.windowEndId).toBe(45);
    expect(next.latestMessageId).toBe(45);
  });

  it('does not keep an older own message across the gap', () => {
    const current = thread({
      messages: [message(10, { outgoing: true }), message(20)],
      windowEndId: 20,
      latestMessageId: 20,
    });
    const fresh = [message(30), message(31)];
    const next = mergeCacheRefresh(current, fresh, dialog({ lastMessage: { ...dialog().lastMessage!, id: 31 } }), 20);

    expect(next.messages.map((entry) => entry.id)).toEqual([30, 31]);
  });

  it('keeps the painted window when the fresh read is empty', () => {
    const current = thread();
    const next = mergeCacheRefresh(current, [], dialog({ lastMessage: null }), 20);

    expect(next.messages).toEqual(current.messages);
    expect(next.windowEndId).toBe(20);
    expect(next.latestMessageId).toBe(20);
  });
});
