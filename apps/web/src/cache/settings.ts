import { useSyncExternalStore } from 'react';

/**
The reader's local-data budget. It is a device choice, like the theme and
the data-saver switches, so it lives in `localStorage` and never reaches the
engine. Zero turns the persistent cache off; the in-memory thread cache
still works, because that costs no disk and disappears with the tab.
*/

export type CacheSizeOption = 0 | 25 | 50 | 100 | 250 | 500;

export const CACHE_SIZE_OPTIONS: readonly CacheSizeOption[] = [0, 25, 50, 100, 250, 500];
export const DEFAULT_CACHE_SIZE: CacheSizeOption = 100;

const STORAGE_KEY = 'pigeongram-cache-size';
const BYTES_PER_MB = 1024 * 1024;

function read(): CacheSizeOption {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_CACHE_SIZE;
    const value = Number(raw);
    return CACHE_SIZE_OPTIONS.find((option) => option === value) ?? DEFAULT_CACHE_SIZE;
  } catch {
    return DEFAULT_CACHE_SIZE;
  }
}

let current: CacheSizeOption = read();
const listeners = new Set<() => void>();

export function getCacheSize(): CacheSizeOption {
  return current;
}

/**
Writes the choice and announces it. The Storage section applies the
consequence — purge at zero, prune when the cap shrinks — so this module
stays a plain preference with no dependency on the store.
*/
export function setCacheSize(size: CacheSizeOption): void {
  if (size === current) return;
  current = size;
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // A private window may refuse storage; the in-memory choice still holds.
  }
  for (const listener of listeners) listener();
}

export function subscribeCacheSize(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function cacheLimitBytes(): number {
  return current * BYTES_PER_MB;
}

export function useCacheSize(): CacheSizeOption {
  return useSyncExternalStore(subscribeCacheSize, getCacheSize, () => DEFAULT_CACHE_SIZE);
}

/**
Formats a cache size for the usage row. The raw values are dynamic, so they
keep their own casing; the wrapper words are authored copy at the call site.
*/
export function formatCacheSize(bytes: number): string {
  if (bytes < BYTES_PER_MB) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}
