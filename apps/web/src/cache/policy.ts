import type { ChatThread } from '../thread-state';
import type { DialogDto } from '../types';
import type { CacheRecord, CacheStoreName } from './db';

/**
The cache's policy, kept free of IndexedDB so the rules can be tested
directly: what is worth storing, how big an entry is, and what falls out
first when the reader's size budget is reached.
*/

/**
A reopened thread paints a window, not a whole archive. Keeping the newest
rows is enough for the refresh that follows an open and bounds one entry.
*/
export const MAX_THREAD_MESSAGES = 200;

export interface CacheEntryInfo {
  store: CacheStoreName;
  key: string;
  size: number;
  accessedAt: number;
}

/**
Approximate UTF-8 bytes. Exactness is not needed: this drives an LRU cap,
and the browser's own quota is the hard limit.
*/
export function approxSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

/**
Drops the fields that belong to a live open, not to the stored window. An
entrance animation must not replay on a reopen and a linked-post focus is
a navigation, not a fact about the chat.
*/
export function sanitizeThread(thread: ChatThread): ChatThread {
  return {
    ...thread,
    messages: thread.messages.slice(-MAX_THREAD_MESSAGES),
    newMessageIds: new Set<number>(),
    focusMessageId: null,
  };
}

/**
Minimum shape checks. A record the app wrote itself is trusted apart from
being the right kind of value; anything else is dropped rather than poured
into state.
*/
export function isDialogList(value: unknown): value is DialogDto[] {
  return (
    Array.isArray(value) && value.every((dialog) => typeof dialog === 'object' && dialog !== null && typeof dialog.chat?.id === 'number')
  );
}

export function isProfile(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number';
}

export function isStickerLibrary(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Array.isArray((value as { sets?: unknown }).sets);
}

/**
What falls out first: the content a reader can ask Telegram for again
cheaply, before the chat list that makes the whole shell paint.
*/
const EVICTION_PRIORITY: Record<CacheStoreName, number> = {
  stickers: 0,
  profiles: 1,
  threads: 2,
  dialogs: 3,
  meta: 4,
};

export function evictionOrder(entries: readonly CacheEntryInfo[]): CacheEntryInfo[] {
  return [...entries].sort(
    (left, right) => EVICTION_PRIORITY[left.store] - EVICTION_PRIORITY[right.store] || left.accessedAt - right.accessedAt,
  );
}

/**
The oldest, cheapest entries to delete until the budget is met. The caller
deletes them; this function is pure so the ordering is unit-testable.
*/
export function evictionPlan(entries: readonly CacheEntryInfo[], totalBytes: number, limitBytes: number): CacheEntryInfo[] {
  if (totalBytes <= limitBytes) return [];
  let remaining = totalBytes;
  const plan: CacheEntryInfo[] = [];
  for (const entry of evictionOrder(entries)) {
    if (remaining <= limitBytes) break;
    plan.push(entry);
    remaining -= entry.size;
  }
  return plan;
}

export function entryInfo(store: CacheStoreName, record: CacheRecord): CacheEntryInfo {
  return { store, key: record.key, size: record.size, accessedAt: record.accessedAt };
}
