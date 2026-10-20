import type { FileLocation } from '@mtcute/core';
import { EngineError } from './errors';

/**
 * Byte-window streaming for the media routes.
 *
 * One `/api/file` response is one window: the offset the download starts from,
 * the bytes the alignment dragged in before the requested start, and the
 * length to serve. The offset starts on a 1 MB part block rather than merely
 * Telegram's documented 4 KB minimum: mtcute fetches 128 KB–1 MB chunks
 * without `precise`, and a part that straddles a 1 MB boundary is rejected
 * with `LIMIT_INVALID` (see `media.ts`). The window is enforced here rather
 * than through mtcute's `limit`, because `downloadAsIterable` accepts only the
 * whole file size or a ≤1 MB divisor of 1 MB and rejects everything else with
 * `MtArgumentError` — thrown on the first pull, with the `206` response
 * headers already sent. That is what broke `<video>` seeking, and Safari's
 * `bytes=0-1` probe before a single frame was ever sent. So the download is
 * started unbounded and paced by `throttle` instead: the consumer's read
 * position decides how far the download runs ahead, never the file size.
 */

export interface DownloadWindow {
  /**
   * Byte offset to start downloading from; 1 MB-aligned so that mtcute's
   * chunks never cross a Telegram part block.
   */
  offset: number;
  /**
   * Bytes after `offset` that belong before the requested window; the
   * alignment above is what puts them there.
   */
  drop: number;
  /**
   * Number of bytes to serve, or null to serve until the file ends.
   */
  length: number | null;
}

/**
 * The download parameters this module builds. A subset of mtcute's
 * `FileDownloadParameters`, minus `limit` — see the module comment.
 */
export interface DownloadParams {
  fileSize?: number;
  offset?: number;
  abortSignal?: AbortSignal;
  /**
   * Called before every chunk fetch; resolving parks the download until the
   * consumer asks for more. Throws once the response has been cancelled.
   */
  throttle?: (chunkSize: number) => Promise<void> | void;
}

/**
 * The slice of mtcute's client that the download path needs. Narrow on
 * purpose: this is the seam a test stands in for.
 */
export interface DownloadSource {
  downloadAsIterable(location: FileLocation, params: DownloadParams): AsyncIterableIterator<Uint8Array>;
}

/**
 * Streams one byte window of `location`.
 *
 * The stream ends after exactly `window.length` bytes (or at the file's end
 * when it is null), errors if the file ends inside a promised window, and —
 * on cancel — aborts the download instead of letting mtcute's workers retry
 * on their own (`maxRetryCount: Infinity` in its download loop).
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
    // One chunk of buffer: a download chunk is 64 KB–1 MB, and `throttle`
    // parks the download while the queued one sits unread.
    { highWaterMark: 1, size: (chunk) => chunk.byteLength },
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
        offset: window.offset,
        abortSignal: abort.signal,
        throttle: async () => {
          stopIfCancelled();
          if (controller.desiredSize !== null && controller.desiredSize <= 0) await gate.wait();
          stopIfCancelled();
        },
      });

      while (remaining > 0 || drop > 0) {
        const { done, value } = await iterator.next();
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
      if (!cancelled) controller.error(error);
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
 * The producer half of the backpressure: `pull` opens the gate, and the
 * download's `throttle` waits on it while the stream already holds a chunk.
 * This mirrors mtcute's own `downloadAsStream`, which cannot be used here
 * because its `cancel` never aborts the download workers.
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
