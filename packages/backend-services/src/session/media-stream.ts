import type { FileLocation } from '@mtcute/core';
import { EngineError } from './errors';
import { log } from './log';

/**
How far a response may read ahead of its consumer.

A full download gets a whole megabyte: mtcute's six `upload.getFile` parts
stay in flight while the browser writes the file, instead of every batch
waiting for a fresh `pull()` on the Durable Object's single thread.

A browser range gets much less. A paused or seeking player stops reading,
and a large buffer would keep fetching the rest of its window — burning
Telegram traffic and connection slots for bytes nobody will play.
*/
export const DOWNLOAD_BUFFER_BYTES = 1024 * 1024;
export const RANGE_BUFFER_BYTES = 256 * 1024;

/**
A part this slow is almost always Telegram's `FLOOD_WAIT` being slept in
full inside mtcute (`floodSleepThreshold: Infinity`), which is silent below
five seconds. The log line makes that visible without reading mtcute.
*/
const SLOW_PART_MS = 1000;

/**
Byte-window streaming for the media routes.

One `/user/file` response is one window: the offset the download starts from,
the bytes the alignment dragged in before the requested start, and the
length to serve. The offset is aligned to the part size the download is told
to use, which is what keeps every `upload.getFile` inside one 1 MB Telegram
block: a part that straddles a boundary is rejected with `LIMIT_INVALID`
(see `media.ts`). The window is enforced here rather than through mtcute's
`limit`, because `downloadAsIterable` accepts only the whole file size or a
≤1 MB divisor of 1 MB and rejects everything else with `MtArgumentError` —
thrown on the first pull, with the `206` response headers already sent. That
is what broke `<video>` seeking, and Safari's `bytes=0-1` probe before a
single frame was ever sent. So the download is started unbounded and paced by
`throttle` instead: the consumer's read position decides how far the download
runs ahead, never the file size.
*/

export interface DownloadWindow {
  /**
  Byte offset to start downloading from; aligned to `partSize` so that
  mtcute's chunks never cross a Telegram part block.
  */
  offset: number;
  /**
  Bytes after `offset` that belong before the requested window; the
  alignment above is what puts them there.
  */
  drop: number;
  /**
  Number of bytes to serve, or null to serve until the file ends.
  */
  length: number | null;
  /**
  Chunk size in KB. Passing it explicitly is what lets the alignment and the
  download agree without either side assuming the other's default.
  */
  partSize?: number;
  /**
  Bytes the response may hold before the download parks. Callers choose it
  by intent: a full download reads ahead, a browser range stays tight so a
  paused player stops the fetch.
  */
  bufferBytes: number;
  /**
  Called when the download itself fails. The engine uses it to evict a
  cached file location whose `file_reference` Telegram no longer accepts,
  so the next range resolution asks Telegram again.
  */
  onSourceError?: (error: unknown) => void;
}

/**
The download parameters this module builds. A subset of mtcute's
`FileDownloadParameters`, minus `limit` — see the module comment.
*/
export interface DownloadParams {
  fileSize?: number;
  /**
  Chunk size in KB, chosen with the offset alignment in `media.ts`.
  */
  partSize?: number;
  offset?: number;
  abortSignal?: AbortSignal;
  /**
  Called before every chunk fetch; resolving parks the download until the
  consumer asks for more. Throws once the response has been cancelled.
  */
  throttle?: (chunkSize: number) => Promise<void> | void;
}

/**
The slice of mtcute's client that the download path needs. Narrow on
purpose: this is the seam a test stands in for.
*/
export interface DownloadSource {
  downloadAsIterable(location: FileLocation, params: DownloadParams): AsyncIterableIterator<Uint8Array>;
}

/**
Streams one byte window of `location`.

The stream ends after exactly `window.length` bytes (or at the file's end
when it is null), errors if the file ends inside a promised window, and —
on cancel — aborts the download instead of letting mtcute's workers retry
on their own (`maxRetryCount: Infinity` in its download loop).
*/
export function windowedStream(source: DownloadSource, location: FileLocation, window: DownloadWindow): ReadableStream<Uint8Array> {
  const gate = new BackpressureGate();
  const abort = new AbortController();
  let cancelled = false;
  let iterator: AsyncIterableIterator<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        void pump(controller);
      },
      pull() {
        gate.open();
      },
      cancel(reason) {
        cancelled = true;
        // A download parked on backpressure would otherwise wait for a pull
        // that a cancelled stream never makes; waking it lets it see the flag.
        gate.open();
        abort.abort(reason);
        void iterator?.return?.(undefined).catch(() => {});
      },
    },
    // `size` is in bytes, so this is a real byte budget, not a chunk count.
    // mtcute parks its parts once the budget is full and resumes on `pull()`.
    { highWaterMark: window.bufferBytes, size: (chunk) => chunk.byteLength },
  );

  function stopIfCancelled(): void {
    if (cancelled) throw new DOMException('The download was cancelled', 'AbortError');
  }

  async function pump(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    let remaining = window.length ?? Infinity;
    let drop = window.drop;
    try {
      iterator = source.downloadAsIterable(location, {
        ...(location.fileSize !== undefined && { fileSize: location.fileSize }),
        ...(window.partSize !== undefined && { partSize: window.partSize }),
        offset: window.offset,
        abortSignal: abort.signal,
        throttle: async () => {
          stopIfCancelled();
          if (controller.desiredSize !== null && controller.desiredSize <= 0) await gate.wait();
          stopIfCancelled();
        },
      });

      while (remaining > 0 || drop > 0) {
        const started = Date.now();
        const { done, value } = await iterator.next();
        const elapsed = Date.now() - started;
        if (elapsed > SLOW_PART_MS) {
          // A full FLOOD_WAIT sleep inside mtcute looks exactly like a slow
          // part; name it so a throttled download is queryable in Workers Logs.
          log.warn('media.part_slow', { ms: elapsed, bytes: value?.byteLength ?? 0, offset: window.offset });
        }
        if (done) break;
        let chunk = value;
        if (drop > 0) {
          if (chunk.byteLength <= drop) {
            drop -= chunk.byteLength;
            continue;
          }
          chunk = chunk.subarray(drop);
          drop = 0;
        }
        if (chunk.byteLength > remaining) chunk = chunk.subarray(0, remaining);
        remaining -= chunk.byteLength;
        if (cancelled) return;
        controller.enqueue(chunk);
      }

      if (drop > 0 || (window.length !== null && remaining > 0)) {
        // The file ended inside the promised window: the `content-length` in
        // the headers can no longer be honoured, and a silently short body
        // would look like a corrupt file to the player.
        if (!cancelled) controller.error(new EngineError('File ended before the requested range was served', 502));
        return;
      }
      if (!cancelled) controller.close();
    } catch (error) {
      if (!cancelled) {
        window.onSourceError?.(error);
        controller.error(error);
      }
    } finally {
      const open = iterator;
      iterator = null;
      // Whatever is still in flight is no longer wanted: the window is
      // served, failed, or the consumer is gone. Aborting also ends calls
      // that mtcute would otherwise keep retrying.
      abort.abort();
      void open?.return?.(undefined).catch(() => {});
    }
  }
}

/**
The producer half of the backpressure: `pull` opens the gate, and the
download's `throttle` waits on it while the stream already holds a chunk.
This mirrors mtcute's own `downloadAsStream`, which cannot be used here
because its `cancel` never aborts the download workers.
*/
class BackpressureGate {
  #waiters: Array<() => void> = [];

  wait(): Promise<void> {
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  open(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const wake of waiters) wake();
  }
}
