/**
The browser cache's storage seam: IndexedDB with one store per kind of
projection, and a record shape that carries its own size and access time.

The cache is disposable. Every helper here is best-effort: a browser with
IndexedDB disabled, a denied quota or a corrupt record answers `null` rather
than failing the screen that asked for a faster paint.
*/

export type CacheStoreName = 'meta' | 'dialogs' | 'threads' | 'profiles' | 'stickers';

const CACHE_STORES: readonly CacheStoreName[] = ['meta', 'dialogs', 'threads', 'profiles', 'stickers'];

export interface CacheRecord<T = unknown> {
  key: string;
  value: T;
  /**
  UTF-8 bytes of the serialised value, used by the configurable size cap.
  */
  size: number;
  savedAt: number;
  accessedAt: number;
}

export interface CacheMeta {
  totalBytes: number;
  schema: number;
}

const DB_NAME = 'pigeongram-cache';
const DB_VERSION = 1;

let connection: Promise<IDBDatabase | null> | null = null;

/**
Whether this browser can hold the cache at all. Read synchronously so a
caller can skip the async path entirely when there is nothing to read — a
cache hit must not put an extra turn behind the first paint.
*/
export function isCacheAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
Opens the cache once per page. A failed open is cached too: repeated calls
must not reopen (and re-upgrade) the database on every read.
*/
export function openCacheDb(): Promise<IDBDatabase | null> {
  if (connection !== null) return connection;
  connection = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      for (const store of CACHE_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'key' });
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => resolve(null));
    request.addEventListener('blocked', () => resolve(null));
  });
  return connection;
}

/**
Resolves the value of one request, or `null` when it failed. Kept as a
helper so no caller has to remember that an IDB request has two outcomes.
*/
function resultOf<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => resolve(null));
  });
}

export async function cacheGet<T>(store: CacheStoreName, key: string): Promise<CacheRecord<T> | null> {
  const db = await openCacheDb();
  if (db === null) return null;
  try {
    const record = await resultOf(db.transaction(store, 'readonly').objectStore(store).get(key));
    return (record as CacheRecord<T> | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function cacheAll(store: CacheStoreName): Promise<CacheRecord[]> {
  const db = await openCacheDb();
  if (db === null) return [];
  try {
    const records = await resultOf(db.transaction(store, 'readonly').objectStore(store).getAll());
    return (records ?? []) as CacheRecord[];
  } catch {
    return [];
  }
}

export async function cachePut<T>(store: CacheStoreName, record: CacheRecord<T>): Promise<boolean> {
  const db = await openCacheDb();
  if (db === null) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const transaction = db.transaction(store, 'readwrite');
      transaction.objectStore(store).put(record);
      transaction.addEventListener('complete', () => resolve(true));
      transaction.addEventListener('error', () => resolve(false));
      transaction.addEventListener('abort', () => resolve(false));
    });
  } catch {
    return false;
  }
}

export async function cacheDelete(store: CacheStoreName, key: string): Promise<boolean> {
  const db = await openCacheDb();
  if (db === null) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const transaction = db.transaction(store, 'readwrite');
      transaction.objectStore(store).delete(key);
      transaction.addEventListener('complete', () => resolve(true));
      transaction.addEventListener('error', () => resolve(false));
      transaction.addEventListener('abort', () => resolve(false));
    });
  } catch {
    return false;
  }
}

/**
Drops the connection and the database. Only tests call this, to keep one
case's projections out of the next one's first paint.
*/
export async function resetCacheDb(): Promise<void> {
  if (connection !== null) {
    const db = await connection;
    db?.close();
    connection = null;
  }
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.addEventListener('success', () => resolve());
      request.addEventListener('error', () => resolve());
      request.addEventListener('blocked', () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function cacheClear(stores: readonly CacheStoreName[] = CACHE_STORES): Promise<void> {
  const db = await openCacheDb();
  if (db === null) return;
  try {
    await new Promise<void>((resolve) => {
      const transaction = db.transaction([...stores], 'readwrite');
      for (const store of stores) transaction.objectStore(store).clear();
      transaction.addEventListener('complete', () => resolve());
      transaction.addEventListener('error', () => resolve());
      transaction.addEventListener('abort', () => resolve());
    });
  } catch {
    // A cache that cannot be cleared is still a cache that cannot be read.
  }
}
