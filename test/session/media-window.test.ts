import { Long } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { RangeNotSatisfiableError } from '../../packages/backend-services/src/session/errors';
import { partSizeKb, planWindow } from '../../packages/backend-services/src/session/media-window';
import { StickerRegistry } from '../../packages/backend-services/src/session/sticker-registry';

/**
Two small, load-bearing pieces of the media path.

A range that is not aligned to mtcute's part size is rejected by Telegram
after the `206` headers are already on the wire, so the plan is where a
browser seek has to be made safe. The sticker registry is the only place the
browser's opaque id is resolved, and its bound keeps a long-lived isolate
from holding every sticker it has ever read.
*/
describe('planWindow', () => {
  const MB = 1024 * 1024;

  it('aligns a seek to the part size and drops the prefix locally', () => {
    const plan = planWindow({ start: 300_000, end: 310_000 }, 50 * MB, MB);
    expect(plan.offset % (plan.partSize * 1024)).toBe(0);
    expect(plan.drop).toBe(300_000 - plan.offset);
    expect(plan.length).toBe(10_001);
  });

  it('uses the smallest legal part for a short probe', () => {
    const plan = planWindow({ start: 0, end: 1 }, 500 * MB, MB);
    expect(plan.partSize).toBe(128);
    expect(plan.length).toBe(2);
  });

  it('resolves a suffix range from the end', () => {
    const plan = planWindow({ suffix: 500 }, 10_000, MB);
    expect(plan.length).toBe(500);
    expect(plan.drop + plan.length).toBeLessThanOrEqual(10_000);
  });

  it('rejects a range that starts past the file with its size attached', () => {
    try {
      planWindow({ start: 10_000, end: 10_001 }, 1000, MB);
      expect.unreachable();
    } catch (failure) {
      expect(failure).toBeInstanceOf(RangeNotSatisfiableError);
      expect((failure as RangeNotSatisfiableError).size).toBe(1000);
    }
  });

  it('caps the part by the deployment window and never below 4 KB', () => {
    expect(partSizeKb(500 * MB, 2 * MB, 32 * 1024)).toBe(32);
    expect(partSizeKb(500 * MB, 2 * MB, 1024)).toBe(4);
  });
});

describe('StickerRegistry', () => {
  function sticker(id: number): never {
    return { raw: { id: Long.fromNumber(id), accessHash: 1n, fileReference: new Uint8Array() } } as never;
  }

  it('names a document by its decimal id and reads it back', () => {
    const registry = new StickerRegistry();
    const id = registry.remember(sticker(12_345));
    expect(id).toBe('12345');
    expect(registry.get(id)).toBeDefined();
    registry.clear();
    expect(registry.get(id)).toBeNull();
  });

  it('evicts the oldest entry once the registry is full', () => {
    const registry = new StickerRegistry();
    for (let id = 1; id <= 600; id += 1) registry.remember(sticker(id));
    // Re-adding id 1 makes it the newest; the next insertion must evict 2.
    registry.remember(sticker(1));
    registry.remember(sticker(601));
    expect(registry.get('1')).toBeDefined();
    expect(registry.get('2')).toBeNull();
    expect(registry.get('601')).toBeDefined();
  });
});
