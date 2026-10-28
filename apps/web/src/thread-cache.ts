import { firstUnread } from './reading';
import { mergeMessages } from './state';
import { threadReachesLatest } from './thread-state';
import type { ChatThread } from './thread-state';
import { OPEN_LIMIT } from './thread-window';
import type { DialogDto, MessageDto, PeerId } from './types';

/**
 * The last few fully-read threads, kept so reopening a chat paints its window
 * at once instead of waiting for another history read. The cache is memory
 * only: the server stays the truth, and a cached thread is a paint, not an
 * answer — `useThreadOpen` revalidates the newest page beside it.
 */

/**
A reopen is instant, but a conversation moves on. A thread older than this is
read again from the start rather than painted and corrected.
*/
export const THREAD_CACHE_TTL_MS = 60_000;

/**
How many threads stay cached. Enough for the chats a reader moves between,
without keeping a session's whole history in memory.
*/
export const THREAD_CACHE_LIMIT = 3;

interface CacheEntry {
  thread: ChatThread;
  cachedAt: number;
}

/**
 * A small least-recently-used cache of opened threads. Only a thread that
 * reaches the chat's newest message with no focus anchor is worth painting:
 * an unread backlog or a linked-post jump has its own landing rule, and a
 * cached copy would have to be replaced rather than extended.
 */
export class ThreadCache {
  readonly #entries = new Map<PeerId, CacheEntry>();

  get(chatId: PeerId, now = Date.now()): ChatThread | null {
    const entry = this.#entries.get(chatId);
    if (entry === undefined) return null;
    this.#entries.delete(chatId);
    if (now - entry.cachedAt > THREAD_CACHE_TTL_MS) return null;
    // A fresh read moves the entry to the recent end of the LRU.
    this.#entries.set(chatId, entry);
    return entry.thread;
  }

  set(thread: ChatThread, now = Date.now()): void {
    if (!cacheableThread(thread)) return;
    const chatId = thread.chat.id;
    this.#entries.delete(chatId);
    this.#entries.set(chatId, { thread, cachedAt: now });
    while (this.#entries.size > THREAD_CACHE_LIMIT) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }
}

function cacheableThread(thread: ChatThread): boolean {
  return thread.messages.length > 0 && thread.windowEndId !== null && thread.focusMessageId === null && threadReachesLatest(thread);
}

/**
 * The thread a reopen can paint before its read lands, or null when the cache
 * cannot serve this open. A chat with unread messages opens at its own divider,
 * not where the last visit left it, and a dialog whose newest message sits
 * beyond one opening page would leave a gap between the painted window and the
 * read that follows.
 */
export function cachedOpen(cached: ChatThread | null, dialog: DialogDto): ChatThread | null {
  if (cached === null || cached.chat.id !== dialog.chat.id || dialog.unread > 0) return null;
  const newest = dialog.lastMessage?.id ?? 0;
  const loaded = cached.latestMessageId ?? 0;
  if (newest < loaded || newest - loaded > OPEN_LIMIT) return null;
  const readInboxMaxId = Math.max(cached.readInboxMaxId, dialog.readInboxMaxId);
  return {
    ...cached,
    chat: dialog.chat,
    readInboxMaxId,
    readOutboxMaxId: Math.max(cached.readOutboxMaxId, dialog.readOutboxMaxId),
    unreadDividerId: firstUnread(cached.messages, readInboxMaxId)?.id ?? null,
    focusMessageId: null,
    // The painted window is behind the dialog's newest message. Carrying that
    // id keeps a live message that arrives before the refresh from being
    // appended across the gap the refresh is about to fill.
    latestMessageId: Math.max(cached.latestMessageId ?? 0, newest),
  };
}

/**
 * Folds the newest page a cached open revalidated into the painted thread. The
 * page is read without a cursor, so it may overlap the cached window or sit
 * beyond it after a burst of messages. An overlap extends the loaded range; a
 * page beyond a gap replaces it, keeping only the messages newer than the page
 * (a send or a live message that raced the read) and letting forward paging
 * fill the hole.
 */
export function mergeCacheRefresh(
  current: ChatThread,
  fresh: readonly MessageDto[],
  dialog: DialogDto,
  openingReadInboxMaxId: number,
): ChatThread {
  const readInboxMaxId = Math.max(current.readInboxMaxId, dialog.readInboxMaxId);
  const readOutboxMaxId = Math.max(current.readOutboxMaxId, dialog.readOutboxMaxId);
  const latestKnown = Math.max(current.latestMessageId ?? 0, dialog.lastMessage?.id ?? 0);
  if (fresh.length === 0) {
    return { ...current, readInboxMaxId, readOutboxMaxId, latestMessageId: latestKnown };
  }
  const freshOldest = fresh[0].id;
  const freshNewest = fresh.at(-1)?.id ?? freshOldest;
  const latestMessageId = Math.max(latestKnown, freshNewest);
  const end = current.windowEndId;
  const overlap = end !== null && freshOldest <= end + 1;
  if (!overlap) {
    // The cached window is behind a gap. Keep only what is newer than the page
    // — the loaded range continues there — and page into the gap from the
    // page's end. An older own message would sit across the hole.
    const beyond = current.messages.filter((message) => message.id > freshNewest);
    const messages = mergeMessages([...fresh], beyond);
    const newest = messages.at(-1)?.id ?? freshNewest;
    return {
      ...current,
      messages,
      hasMoreOlder: fresh.length >= OPEN_LIMIT,
      unreadDividerId: firstUnread(messages, openingReadInboxMaxId)?.id ?? null,
      windowEndId: Math.max(freshNewest, newest),
      latestMessageId: Math.max(latestMessageId, newest),
      readInboxMaxId,
      readOutboxMaxId,
    };
  }
  const messages = mergeMessages(current.messages, [...fresh]);
  return {
    ...current,
    messages,
    unreadDividerId: firstUnread(messages, openingReadInboxMaxId)?.id ?? null,
    windowEndId: Math.max(end ?? 0, freshNewest),
    latestMessageId,
    readInboxMaxId,
    readOutboxMaxId,
  };
}
