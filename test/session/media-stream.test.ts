import type { FileLocation } from '@mtcute/core';
import { downloadAsIterable } from '@mtcute/core/methods.js';
import { describe, expect, it } from 'vitest';
import type { DownloadParams, DownloadSource } from '../../packages/backend-services/src/session/media-stream';
import { windowedStream } from '../../packages/backend-services/src/session/media-stream';

/**
 * `windowedStream` is where browser ranges are turned into byte windows: the
 * part-block-aligned offset, the dropped prefix and the cut tail. The stream
 * behaviour matters as much as the arithmetic — a range that runs ahead of the
 * player buffers the file in the isolate, and one that keeps downloading after
 * the player left burns connection slots.
 */

const LOCATION = { fileSize: 4096 * 32 } as unknown as FileLocation;

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }
  return joined;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return concat(parts);
}

/**
 * A quiet turn of the event loop, enough for the stream's pump and the fake
 * download's microtasks to settle.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface SourceState {
  params: DownloadParams | null;
  pulled: number;
  returned: boolean;
}

/**
 * A stand-in download source: yields `chunks` in order and runs `throttle`
 * before every chunk, the way mtcute's worker loop does. Records the params it
 * was handed and whether the iterator was returned early.
 */
function fakeSource(chunks: readonly Uint8Array[]): { source: DownloadSource; state: SourceState } {
  const state: SourceState = { params: null, pulled: 0, returned: false };
  const source: DownloadSource = {
    downloadAsIterable(_location, params) {
      state.params = params;
      return (async function* () {
        try {
          for (const chunk of chunks) {
            await params.throttle?.(chunk.byteLength);
            state.pulled += 1;
            yield chunk;
          }
        } finally {
          state.returned = true;
        }
      })();
    },
  };
  return { source, state };
}

describe('windowedStream', () => {
  it('serves the whole file when the window has no end', async () => {
    const { source, state } = fakeSource([bytes(1, 2, 3), bytes(4, 5)]);
    const stream = windowedStream(source, LOCATION, { offset: 0, drop: 0, length: null });

    await expect(collect(stream)).resolves.toEqual(bytes(1, 2, 3, 4, 5));
    expect(state.params).toMatchObject({ offset: 0, fileSize: 4096 * 32 });
    // The window is cut here; mtcute's `limit` rejects browser-sized windows.
    expect(state.params).not.toHaveProperty('limit');
  });

  it("serves Safari's two-byte range probe exactly", async () => {
    const { source, state } = fakeSource([bytes(10, 11, 12, 13), bytes(20, 21)]);
    const stream = windowedStream(source, LOCATION, { offset: 0, drop: 0, length: 2 });

    await expect(collect(stream)).resolves.toEqual(bytes(10, 11));
    expect(state.pulled).toBe(1);
  });

  it('drops the alignment prefix and cuts the tail', async () => {
    // bytes=5-9 of a download that starts at the aligned offset 4.
    const { source, state } = fakeSource([bytes(1, 2, 3, 4), bytes(5, 6, 7, 8), bytes(9, 10)]);
    const stream = windowedStream(source, LOCATION, { offset: 4, drop: 1, length: 5 });

    await expect(collect(stream)).resolves.toEqual(bytes(2, 3, 4, 5, 6));
    expect(state.params?.offset).toBe(4);
  });

  it('stops the download once the window is served', async () => {
    const { source, state } = fakeSource([bytes(1, 2, 3), bytes(4, 5, 6)]);
    const stream = windowedStream(source, LOCATION, { offset: 0, drop: 0, length: 2 });

    await expect(collect(stream)).resolves.toEqual(bytes(1, 2));
    await tick();
    expect(state.pulled).toBe(1);
    expect(state.returned).toBe(true);
  });

  it('paces the download to the consumer instead of prefetching the file', async () => {
    const chunks = Array.from({ length: 50 }, (_, index) => bytes(index));
    const { source, state } = fakeSource(chunks);
    const stream = windowedStream(source, LOCATION, { offset: 0, drop: 0, length: null });
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toMatchObject({ value: bytes(0) });
    await tick();
    // One buffered chunk plus the one the read released; never the 50-chunk
    // file a player pausing on the first frame would otherwise pull.
    expect(state.pulled).toBeLessThanOrEqual(2);

    await reader.cancel();
    await tick();
    expect(state.params?.abortSignal?.aborted).toBe(true);
    expect(state.returned).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(2);
  });

  it('errors when the file ends inside the promised window', async () => {
    const { source } = fakeSource([bytes(1, 2)]);
    const stream = windowedStream(source, LOCATION, { offset: 0, drop: 0, length: 4 });

    await expect(collect(stream)).rejects.toThrow('ended before the requested range');
  });
});

const MIB = 1024 * 1024;

/**
 * A stand-in for Telegram's `upload.getFile` server checks (core.telegram.org/
 * api/files): the part is 4 KB-aligned, `limit` divides 1 MB, and — the rule
 * that broke deep video seeks — the whole part stays inside one 1 MB block.
 */
function telegramClient(): {
  client: Parameters<typeof downloadAsIterable>[0];
  requests: Array<{ offset: number; limit: number }>;
} {
  const requests: Array<{ offset: number; limit: number }> = [];
  const client = {
    async getPrimaryDcId(): Promise<number> {
      return 2;
    },
    async getPoolSize(): Promise<number> {
      return 1;
    },
    log: { debug(): void {} },
    async call(request: { offset: number; limit: number }): Promise<{ _: 'upload.file'; bytes: Uint8Array }> {
      const { offset, limit } = request;
      if (offset % 4096 !== 0) throw new Error('OFFSET_INVALID');
      if (limit % 4096 !== 0 || MIB % limit !== 0) throw new Error('LIMIT_INVALID');
      if (Math.floor(offset / MIB) !== Math.floor((offset + limit - 1) / MIB)) throw new Error('LIMIT_INVALID');
      requests.push({ offset, limit });
      return { _: 'upload.file', bytes: new Uint8Array(limit) };
    },
  };
  return {
    client: client as unknown as Parameters<typeof downloadAsIterable>[0],
    requests,
  };
}

function realSource(client: Parameters<typeof downloadAsIterable>[0]): DownloadSource {
  return {
    downloadAsIterable(location, params) {
      return downloadAsIterable(client, location, params);
    },
  };
}

describe('windowedStream × mtcute', () => {
  /**
   * The regression guard for the original outages: mtcute validates the
   * download params in a generator that only runs on the first pull, so a
   * window it rejects fails after the `206` headers are on the wire. The real
   * generator does the chunking here; the stub client stands in for Telegram.
   */
  it('builds params the real download accepts for a mid-file range', async () => {
    const { client, requests } = telegramClient();
    const fileSize = 16 * MIB;
    const stream = windowedStream(realSource(client), { fileSize } as unknown as FileLocation, {
      offset: MIB,
      drop: 0,
      length: 2,
    });
    const first = await stream.getReader().read();

    expect(first.value?.byteLength).toBe(2);
    // The download starts exactly at the block-aligned window offset.
    expect(requests[0]?.offset).toBe(MIB);
  });

  it('rejects the 4 KB-only alignment that returned LIMIT_INVALID', async () => {
    const { client } = telegramClient();
    // 64 KB before the second 1 MB boundary: the shape of the failed
    // `bytes=259981312-` request. `media.ts` now aligns this down to block 1.
    const stream = windowedStream(realSource(client), { fileSize: 16 * MIB } as unknown as FileLocation, {
      offset: MIB - 64 * 1024,
      drop: 0,
      length: 2,
    });

    await expect(collect(stream)).rejects.toThrow('LIMIT_INVALID');
  });
});
