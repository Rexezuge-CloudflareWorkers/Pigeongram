import { useSyncExternalStore } from 'react';
import { cacheableThread } from '../thread-cache';
import type { ChatThread } from '../thread-state';
import type { DialogDto, MeDto, PeerId, ProfileDto, StickerLibraryDto } from '../types';
import { cacheAll, cacheClear, cacheDelete, cacheGet, cachePut, resetCacheDb } from './db';
import type { CacheRecord, CacheStoreName, CacheMeta } from './db';
import { approxSize, entryInfo, evictionPlan, isDialogList, isProfile, isStickerLibrary, sanitizeThread } from './policy';
import { cacheLimitBytes } from './settings';

/**
The app's browser cache: structured data painted before the network answer,
never used as the answer itself. The engine remains the truth; a cached
value is only what the reader sees while a fresh read is in flight.

Writes are best-effort everywhere. A quota error, a private window or a
corrupt record only costs the faster paint.
*/

const META_KEY = 'meta';
const SCHEMA = 1;

type DataStore = Exclude<CacheStoreName, 'meta'>;

export interface DialogSnapshot {
  dialogs: DialogDto[];
  archived: DialogDto[];
  me: MeDto | null;
  savedAt: number;
}

let initialized: Promise<void> | null = null;
let totalBytes = 0;
const usageListeners = new Set<() => void>();

/**
Test seam: drops the stored projections and the module's running total.
*/
export async function resetCache(): Promise<void> {
  initialized = null;
  totalBytes = 0;
  announceUsage();
  await resetCacheDb();
}

function announceUsage(): void {
  for (const listener of usageListeners) listener();
}

function getCacheUsage(): number {
  return totalBytes;
}

function subscribeCacheUsage(listener: () => void): () => void {
  usageListeners.add(listener);
  return () => {
    usageListeners.delete(listener);
  };
}

export function useCacheUsage(): number {
  return useSyncExternalStore(subscribeCacheUsage, getCacheUsage, () => 0);
}

/**
Reads the stored sizes once, then keeps the running total in memory. A
reload recomputes it, so two tabs racing on `meta` cannot drift forever.
*/
async function refreshUsage(): Promise<void> {
  if (initialized === null) {
    initialized = (async () => {
      const entries = await allEntries();
      totalBytes = entries.reduce((sum, entry) => sum + entry.record.size, 0);
      announceUsage();
    })();
  }
  await initialized;
}

async function allEntries(): Promise<Array<{ store: DataStore; record: CacheRecord }>> {
  const entries: Array<{ store: DataStore; record: CacheRecord }> = [];
  for (const store of ['dialogs', 'threads', 'profiles', 'stickers'] as const) {
    for (const record of await cacheAll(store)) entries.push({ store, record });
  }
  return entries;
}

async function persistMeta(): Promise<void> {
  const now = Date.now();
  const meta: CacheRecord<CacheMeta> = {
    key: META_KEY,
    value: { totalBytes, schema: SCHEMA },
    size: 0,
    savedAt: now,
    accessedAt: now,
  };
  await cachePut('meta', meta);
}

async function prune(): Promise<void> {
  if (cacheLimitBytes() === 0) return;
  const entries = await allEntries();
  const plan = evictionPlan(
    entries.map(({ store, record }) => entryInfo(store, record)),
    totalBytes,
    cacheLimitBytes(),
  );
  if (plan.length === 0) return;
  for (const entry of plan) {
    if (await cacheDelete(entry.store, entry.key)) totalBytes -= entry.size;
  }
  await persistMeta();
  announceUsage();
}

async function write<T>(store: DataStore, key: string, value: T, valid: (value: unknown) => boolean): Promise<void> {
  if (cacheLimitBytes() === 0) return;
  await refreshUsage();
  if (!valid(value)) return;
  const old = await cacheGet(store, key);
  const now = Date.now();
  const record: CacheRecord<T> = { key, value, size: approxSize(value), savedAt: now, accessedAt: now };
  if (!(await cachePut(store, record))) return;
  totalBytes += record.size - (old?.size ?? 0);
  await persistMeta();
  announceUsage();
  await prune();
}

async function read<T>(store: DataStore, key: string, valid: (value: unknown) => boolean): Promise<T | null> {
  if (cacheLimitBytes() === 0) return null;
  await refreshUsage();
  const record = await cacheGet<T>(store, key);
  if (record === null || !valid(record.value)) {
    if (record !== null) await cacheDelete(store, key);
    return null;
  }
  // Touching the access time is what makes eviction least-recently-used. The
  // size is unchanged, so the running total does not move.
  await cachePut(store, { ...record, accessedAt: Date.now() });
  return record.value;
}

function isDialogSnapshot(value: unknown): value is DialogSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<DialogSnapshot>;
  return isDialogList(snapshot.dialogs) && isDialogList(snapshot.archived);
}

function isThread(value: unknown): value is ChatThread {
  if (typeof value !== 'object' || value === null) return false;
  const thread = value as Partial<ChatThread>;
  return typeof thread.chat?.id === 'number' && Array.isArray(thread.messages);
}

/**
The chat list and the account that owned it, painted before the boot read.
*/
export const readDialogs = (): Promise<DialogSnapshot | null> => read<DialogSnapshot>('dialogs', 'snapshot', isDialogSnapshot);

export const writeDialogs = (dialogs: DialogDto[], archived: DialogDto[], me: MeDto | null): Promise<void> =>
  write('dialogs', 'snapshot', { dialogs, archived, me, savedAt: Date.now() }, isDialogSnapshot);

/**
The window a reopen can paint, or null when there is nothing worth keeping.
*/
export async function readThread(chatId: PeerId): Promise<ChatThread | null> {
  const thread = await read<ChatThread>('threads', String(chatId), isThread);
  return thread === null || !cacheableThread(thread) ? null : thread;
}

export async function writeThread(thread: ChatThread): Promise<void> {
  if (!cacheableThread(thread)) return;
  await write('threads', String(thread.chat.id), sanitizeThread(thread), isThread);
}

export const readProfile = (chatId: PeerId): Promise<ProfileDto | null> => read<ProfileDto>('profiles', String(chatId), isProfile);

export const writeProfile = (profile: ProfileDto): Promise<void> => write('profiles', String(profile.id), profile, isProfile);

export const readStickerLibrary = (): Promise<StickerLibraryDto | null> => read<StickerLibraryDto>('stickers', 'library', isStickerLibrary);

export const writeStickerLibrary = (library: StickerLibraryDto): Promise<void> => write('stickers', 'library', library, isStickerLibrary);

/**
Sign-out, an account change or a schema bump drops every local projection.
The engine's push subscription is account state, not cache state, and is
deliberately left alone.
*/
export async function purgeAll(): Promise<void> {
  await refreshUsage();
  await cacheClear();
  totalBytes = 0;
  await persistMeta();
  announceUsage();
}

/**
Applies a smaller budget immediately. Off is handled by the caller with a
purge, because a zero limit must not leave any entry behind.
*/
export async function pruneToLimit(): Promise<void> {
  await refreshUsage();
  await prune();
}

export { isCacheAvailable } from './db';
