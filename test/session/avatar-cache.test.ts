import { describe, expect, it } from 'vitest';
import { AvatarCache } from '../../packages/backend-services/src/session/avatar-cache';
import { createNodeSqlStorage, openNodeDatabase } from './node-sql';

/**
The engine's avatar byte cache: a repeat request must not reach Telegram
again, and the cache must not grow without a bound.
*/

function cache(): AvatarCache {
  return new AvatarCache(createNodeSqlStorage(openNodeDatabase()));
}

describe('AvatarCache', () => {
  it('answers a stored avatar and reports a missing one', () => {
    const store = cache();

    expect(store.read('version-1', 'small')).toBeNull();

    store.write('version-1', 'small', 'image/jpeg', new Uint8Array([1, 2, 3]));

    const found = store.read('version-1', 'small');
    expect(found?.mime).toBe('image/jpeg');
    expect(Array.from(found?.bytes ?? [])).toEqual([1, 2, 3]);
  });

  it('keeps the sizes apart', () => {
    const store = cache();

    store.write('version-1', 'small', 'image/jpeg', new Uint8Array([1]));

    expect(store.read('version-1', 'big')).toBeNull();
  });

  it('replaces the bytes of a version it already knows', () => {
    const store = cache();

    store.write('version-1', 'small', 'image/jpeg', new Uint8Array([1]));
    store.write('version-1', 'small', 'image/jpeg', new Uint8Array([2, 3]));

    expect(Array.from(store.read('version-1', 'small')?.bytes ?? [])).toEqual([2, 3]);
  });

  it('evicts the oldest avatar once the entry cap is exceeded', () => {
    let clock = 0;
    const store = new AvatarCache(createNodeSqlStorage(openNodeDatabase()), () => clock++);
    // The cap is 512 entries; the injected clock makes the write order the
    // eviction order, so the first entry is the one that goes.
    for (let index = 0; index < 512; index++) {
      store.write(`version-${index}`, 'small', 'image/jpeg', new Uint8Array([1]));
    }

    store.write('version-512', 'small', 'image/jpeg', new Uint8Array([1]));

    expect(store.read('version-0', 'small')).toBeNull();
    expect(store.read('version-1', 'small')).not.toBeNull();
    expect(store.read('version-512', 'small')).not.toBeNull();
  });
});
