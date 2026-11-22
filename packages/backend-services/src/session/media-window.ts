import { RangeNotSatisfiableError } from './errors';

/**
The arithmetic behind one ranged media response: which bytes the player
asked for, which part a download may fetch, and where the aligned window
starts.

Telegram requires every `upload.getFile` part to stay inside one 1 MB block —
offset and limit must agree, or the call is rejected with `LIMIT_INVALID`.
mtcute picks its part size from the file size (`128` KB up to 250 MB, then
`256`, `512` and `1024` KB), and this module picks the same one so the
offset can be aligned to exactly that part instead of to the block. Aligning
to the block was safe but wasteful: a seek into a 200 MB video dragged in up
to 896 KB of unwanted prefix per request.
*/

/**
The 1 MB Telegram block. Every part size below divides it, so a part that
starts on a part-size boundary can never straddle a block.
*/
export const PART_BLOCK_BYTES = 1024 * 1024;

/**
A window short enough that fetching a large part would mostly be waste: a
`bytes=0-1` probe or one scrubbed second of video. Such a window uses the
smallest legal part, which keeps the prefetch bounded too — mtcute starts
several part fetches concurrently before the backpressure gate can stop it.
*/
const SHORT_WINDOW_BYTES = 512 * 1024;

/**
The smallest part Telegram accepts (and the one a short window uses).
*/
const SMALLEST_PART_KB = 128;

/**
A browser range: either a start with an optional end, or a suffix length
(`bytes=-500`, the last 500 bytes).
*/
export type MediaRange = { start: number; end: number | null } | { suffix: number };

/**
Resolves a requested range into concrete byte bounds and the aligned window
a download will actually start from.
*/
export interface WindowPlan {
  offset: number;
  drop: number;
  length: number;
  partSize: number;
}

/**
Plans the download for `range` over a file of `size` bytes.

Throws {@link RangeNotSatisfiableError} when the range starts past the end,
so the route can answer `416` with the file's size.
*/
export function planWindow(range: MediaRange, size: number, maxWindowBytes: number): WindowPlan {
  const end = Math.min('suffix' in range ? size - 1 : (range.end ?? size - 1), size - 1);
  const start = 'suffix' in range ? Math.max(0, size - range.suffix) : range.start;
  if (start > end) throw new RangeNotSatisfiableError(size);

  const partSize = partSizeKb(size, end - start + 1, maxWindowBytes);
  const partBytes = partSize * 1024;
  const aligned = start - (start % partBytes);
  return { offset: aligned, drop: start - aligned, length: end - start + 1, partSize };
}

/**
The part size in KB: mtcute's own thresholds for the file, capped by the
deployment's window, and dropped to the smallest part for a short window.

The result is always a multiple of 4 KB and divides 1 MB, so aligning the
offset to it is the invariant Telegram needs.
*/
export function partSizeKb(size: number, windowLength: number, maxWindowBytes: number): number {
  const byFile = size <= 262_078_465 ? 128 : size <= 786_432_000 ? 256 : size <= 2_097_152_000 ? 512 : PART_BLOCK_BYTES / 1024;
  const byWindow = windowLength <= SHORT_WINDOW_BYTES ? SMALLEST_PART_KB : byFile;
  return Math.max(4, Math.min(byWindow, Math.floor(maxWindowBytes / 1024)));
}
