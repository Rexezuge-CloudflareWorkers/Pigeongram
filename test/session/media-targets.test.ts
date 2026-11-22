import { describe, expect, it } from 'vitest';
import type { DownloadableMedia } from '../../packages/backend-services/src/session/media';
import { MediaTargetCache } from '../../packages/backend-services/src/session/media-targets';

/**
The resolved-media cache: the entry that saves a `getMessages` round trip on
every byte-range request of one video, and forgets itself before a Telegram
`file_reference` can go stale.
*/

function file(id: number): DownloadableMedia {
  return { id } as unknown as DownloadableMedia;
}

describe('MediaTargetCache', () => {
  it('answers a repeat request for the same message', () => {
    const cache = new MediaTargetCache();
    const stored = file(1);

    cache.set(2, 3, stored);

    expect(cache.get(2, 3)).toBe(stored);
    // The peer is part of the key: chat 2's message 3 is not chat 4's.
    expect(cache.get(4, 3)).toBeNull();
  });

  it('expires an entry after its TTL', () => {
    let now = 1000;
    const cache = new MediaTargetCache(500, 8, () => now);
    cache.set(2, 3, file(1));

    now = 1499;
    expect(cache.get(2, 3)).not.toBeNull();

    now = 1500;
    expect(cache.get(2, 3)).toBeNull();
  });

  it('evicts the least recently used entry beyond its bound', () => {
    const cache = new MediaTargetCache(60_000, 2);
    cache.set(1, 1, file(1));
    cache.set(1, 2, file(2));
    // Reading 1 makes 2 the eldest.
    expect(cache.get(1, 1)).not.toBeNull();

    cache.set(1, 3, file(3));

    expect(cache.get(1, 1)).not.toBeNull();
    expect(cache.get(1, 2)).toBeNull();
    expect(cache.get(1, 3)).not.toBeNull();
  });

  it('drops an entry on demand and on sign-out', () => {
    const cache = new MediaTargetCache();
    cache.set(1, 1, file(1));
    cache.set(1, 2, file(2));

    cache.delete(1, 1);
    expect(cache.get(1, 1)).toBeNull();

    cache.clear();
    expect(cache.get(1, 2)).toBeNull();
  });
});
