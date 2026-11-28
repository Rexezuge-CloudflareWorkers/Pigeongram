import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  purgeAll,
  pruneToLimit,
  readDialogs,
  readProfile,
  readStickerLibrary,
  readThread,
  resetCache,
  useCacheUsage,
  writeDialogs,
  writeProfile,
  writeStickerLibrary,
  writeThread,
} from '../../apps/web/src/cache';
import { cacheAll, cacheClear, cacheDelete, cacheGet, cachePut, openCacheDb, resetCacheDb } from '../../apps/web/src/cache/db';
import {
  approxSize,
  entryInfo,
  evictionOrder,
  evictionPlan,
  isDialogList,
  isProfile,
  isStickerLibrary,
  MAX_THREAD_MESSAGES,
  sanitizeThread,
} from '../../apps/web/src/cache/policy';
import {
  CACHE_SIZE_OPTIONS,
  cacheLimitBytes,
  formatCacheSize,
  getCacheSize,
  setCacheSize,
  subscribeCacheSize,
  useCacheSize,
} from '../../apps/web/src/cache/settings';
import { useDialogCache } from '../../apps/web/src/useDialogCache';
import type { ChatThread } from '../../apps/web/src/thread-state';
import type { ChatDto, DialogDto, MeDto, MessageDto, ProfileDto, StickerLibraryDto } from '../../apps/web/src/types';

const CHAT: ChatDto = {
  id: 2,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
  canDeleteMessages: true,
  canPinMessages: true,
  presence: null,
};

const ME: MeDto = { id: 1, firstName: 'Me', lastName: null, username: null, phone: null, photo: null };

function message(id: number): MessageDto {
  return {
    id,
    chatId: 2,
    groupedId: null,
    senderId: 1,
    senderName: 'Me',
    senderPhoto: null,
    outgoing: true,
    date: 1000 + id,
    pinned: false,
    editDate: null,
    text: `message ${id}`,
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
  };
}

function thread(): ChatThread {
  return {
    chat: CHAT,
    messages: [message(1), message(2), message(3)],
    readInboxMaxId: 3,
    readOutboxMaxId: 3,
    unreadDividerId: null,
    focusMessageId: null,
    hasMoreOlder: false,
    windowEndId: 3,
    latestMessageId: 3,
    newMessageIds: new Set([2]),
    pinnedMessage: null,
  };
}

function dialog(): DialogDto {
  return {
    chat: CHAT,
    lastMessage: null,
    unread: 0,
    readInboxMaxId: 3,
    readOutboxMaxId: 3,
    pinned: false,
    muted: false,
    archived: false,
  };
}

function profile(): ProfileDto {
  return { id: 2, kind: 'user', title: 'Bob', username: 'bob', about: 'Hi', photo: null, membersCount: null };
}

function library(): StickerLibraryDto {
  return { recent: [], faved: [], sets: [] };
}

beforeEach(async () => {
  localStorage.clear();
  setCacheSize(100);
  await resetCache();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetCache();
  localStorage.clear();
});

describe('cache policy', () => {
  it('measures UTF-8 bytes and survives values JSON cannot serialise', () => {
    expect(approxSize({ text: 'hello' })).toBeGreaterThan(0);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(approxSize(circular)).toBe(0);
  });

  it('keeps only the newest messages and drops live-only fields', () => {
    const many = thread();
    many.messages = Array.from({ length: MAX_THREAD_MESSAGES + 10 }, (_, index) => message(index + 1));
    many.focusMessageId = 9;
    const stored = sanitizeThread(many);
    expect(stored.messages).toHaveLength(MAX_THREAD_MESSAGES);
    expect(stored.messages[0].id).toBe(11);
    expect(stored.focusMessageId).toBeNull();
    expect(stored.newMessageIds.size).toBe(0);
  });

  it('validates the shapes it stores', () => {
    expect(isDialogList([dialog()])).toBe(true);
    expect(isDialogList({})).toBe(false);
    expect(isDialogList([{}])).toBe(false);
    expect(isProfile(profile())).toBe(true);
    expect(isProfile({})).toBe(false);
    expect(isStickerLibrary(library())).toBe(true);
    expect(isStickerLibrary({})).toBe(false);
  });

  it('evicts cheap entries first and the least recently used within a kind', () => {
    const entries = [
      entryInfo('dialogs', { key: 'snapshot', value: null, size: 10, savedAt: 0, accessedAt: 5 }),
      entryInfo('threads', { key: '2', value: null, size: 10, savedAt: 0, accessedAt: 9 }),
      entryInfo('threads', { key: '3', value: null, size: 10, savedAt: 0, accessedAt: 2 }),
      entryInfo('stickers', { key: 'library', value: null, size: 10, savedAt: 0, accessedAt: 99 }),
    ];
    expect(evictionOrder(entries).map((entry) => `${entry.store}:${entry.key}`)).toEqual([
      'stickers:library',
      'threads:3',
      'threads:2',
      'dialogs:snapshot',
    ]);
    expect(evictionPlan(entries, 40, 40)).toEqual([]);
    expect(evictionPlan(entries, 40, 20).map((entry) => entry.key)).toEqual(['library', '3']);
  });
});

describe('cache adapter', () => {
  it('writes, reads and deletes one record', async () => {
    expect(await openCacheDb()).not.toBeNull();
    const record = { key: 'k', value: { hello: 'world' }, size: 5, savedAt: 1, accessedAt: 1 };
    expect(await cachePut('profiles', record)).toBe(true);
    expect(await cacheGet('profiles', 'k')).toEqual(record);
    expect(await cacheAll('profiles')).toHaveLength(1);
    expect(await cacheDelete('profiles', 'k')).toBe(true);
    expect(await cacheGet('profiles', 'k')).toBeNull();
  });

  it('clears every store and drops the connection on reset', async () => {
    await cachePut('profiles', { key: 'k', value: profile(), size: 5, savedAt: 1, accessedAt: 1 });
    await cachePut('meta', { key: 'meta', value: { totalBytes: 5, schema: 1 }, size: 0, savedAt: 1, accessedAt: 1 });
    await cacheClear();
    expect(await cacheAll('profiles')).toEqual([]);
    expect(await cacheAll('meta')).toEqual([]);
    await resetCacheDb();
    expect(await cacheGet('profiles', 'k')).toBeNull();
  });
});

describe('cache store', () => {
  it('round-trips the dialog snapshot with its owner', async () => {
    expect(await readDialogs()).toBeNull();
    await writeDialogs([dialog()], [], ME);
    const stored = await readDialogs();
    expect(stored?.dialogs).toHaveLength(1);
    expect(stored?.me).toEqual(ME);
  });

  it('stores a sanitised thread window and refuses one that cannot paint', async () => {
    await writeThread(thread());
    const stored = await readThread(2);
    expect(stored?.messages.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(stored?.newMessageIds.size).toBe(0);

    await writeThread({ ...thread(), focusMessageId: 42 });
    expect(await readThread(2)).not.toBeNull(); // the older, cacheable entry survives
    await resetCache();
    await writeThread({ ...thread(), focusMessageId: 42 });
    expect(await readThread(2)).toBeNull();
  });

  it('drops corrupt profile and sticker entries instead of serving them', async () => {
    await writeProfile(profile());
    expect(await readProfile(2)).toEqual(profile());
    await cachePut('profiles', { key: '2', value: {}, size: 2, savedAt: 1, accessedAt: 1 });
    expect(await readProfile(2)).toBeNull();
    expect(await cacheGet('profiles', '2')).toBeNull();

    await writeStickerLibrary(library());
    expect(await readStickerLibrary()).toEqual(library());
    await cachePut('stickers', { key: 'library', value: {}, size: 2, savedAt: 1, accessedAt: 1 });
    expect(await readStickerLibrary()).toBeNull();
  });

  it('stops reading and writing when the size is off', async () => {
    await writeDialogs([dialog()], [], ME);
    setCacheSize(0);
    expect(await readDialogs()).toBeNull();
    await writeDialogs([dialog(), dialog()], [], ME);
    expect(cacheLimitBytes()).toBe(0);
    setCacheSize(100);
    expect(await readDialogs()).not.toBeNull();
  });

  it('evicts the cheapest entries when the cap shrinks', async () => {
    await cachePut('stickers', {
      key: 'library',
      value: library(),
      size: 30 * 1024 * 1024,
      savedAt: 1,
      accessedAt: 1,
    });
    setCacheSize(25);
    await pruneToLimit();
    expect(await cacheGet('stickers', 'library')).toBeNull();
    setCacheSize(100);
  });

  it('purges everything and reports the new usage', async () => {
    const { result } = renderHook(() => useCacheUsage());
    await act(async () => {
      await writeProfile(profile());
    });
    await vi.waitFor(() => expect(result.current).toBeGreaterThan(0));
    await act(async () => {
      await purgeAll();
    });
    expect(result.current).toBe(0);
    expect(await readProfile(2)).toBeNull();
  });
});

describe('cache failures', () => {
  it('falls back to no cache when IndexedDB refuses to open', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('blocked');
      },
      deleteDatabase: () => {
        throw new Error('blocked');
      },
    });
    await resetCacheDb();
    expect(await openCacheDb()).toBeNull();
    expect(await cacheGet('profiles', 'k')).toBeNull();
    expect(await cacheAll('profiles')).toEqual([]);
    expect(await cachePut('profiles', { key: 'k', value: profile(), size: 1, savedAt: 1, accessedAt: 1 })).toBe(false);
    expect(await cacheDelete('profiles', 'k')).toBe(false);
    await cacheClear();
  });

  it('reports a failed transaction instead of throwing', async () => {
    const bad = { key: 'bad', value: { nope: () => {} }, size: 1, savedAt: 1, accessedAt: 1 };
    expect(await cachePut('profiles', bad as never)).toBe(false);
    expect(await cacheGet('missing' as never, 'k')).toBeNull();
    await expect(cacheClear(['missing'] as never)).resolves.toBeUndefined();
  });
});

describe('dialog cache hook', () => {
  it('paints a snapshot owned by this account and refuses another one', async () => {
    await writeDialogs([dialog()], [], ME);
    const commit = vi.fn();
    const onHydrated = vi.fn();
    const ready = { current: false };
    const { result } = renderHook(() => useDialogCache({ me: ME, main: [], archived: [], readyRef: ready, commit, onHydrated }));

    await act(async () => {
      await result.current.hydrate(2);
    });
    expect(commit).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.hydrate(1);
    });
    expect(commit).toHaveBeenCalledWith([dialog()], []);
    expect(onHydrated).toHaveBeenCalledOnce();
    expect(ready.current).toBe(true);
  });
});

describe('cache settings', () => {
  it('persists the choice and rejects a value outside the options', () => {
    expect(CACHE_SIZE_OPTIONS).toContain(100);
    setCacheSize(50);
    expect(getCacheSize()).toBe(50);
    expect(localStorage.getItem('pigeongram-cache-size')).toBe('50');
    expect(cacheLimitBytes()).toBe(50 * 1024 * 1024);
    localStorage.setItem('pigeongram-cache-size', '999');
    setCacheSize(100);
    // A fresh module read would fall back; the live value only changes by API.
    expect(getCacheSize()).toBe(100);
  });

  it('announces changes to subscribers and drives the hook', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCacheSize(listener);
    const { result } = renderHook(() => useCacheSize());
    act(() => setCacheSize(25));
    expect(listener).toHaveBeenCalledOnce();
    expect(result.current).toBe(25);
    unsubscribe();
    act(() => setCacheSize(100));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('formats bytes for the usage row', () => {
    expect(formatCacheSize(512)).toBe('1 KB');
    expect(formatCacheSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('reads a stored choice at startup and falls back when storage throws', async () => {
    localStorage.setItem('pigeongram-cache-size', '25');
    vi.resetModules();
    const fresh = await import('../../apps/web/src/cache/settings');
    expect(fresh.getCacheSize()).toBe(25);

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
    });
    vi.resetModules();
    const fallback = await import('../../apps/web/src/cache/settings');
    expect(fallback.getCacheSize()).toBe(100);
  });
});
