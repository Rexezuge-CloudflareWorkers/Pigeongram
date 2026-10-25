import type { FileLocation } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import type { DownloadParams } from '../../packages/backend-services/src/session/media-stream';
import { readAvatar, readAvatarVersion, streamMessageMedia } from '../../packages/backend-services/src/session/media';

/**
 * The window arithmetic of the media downloads: which aligned offset a browser
 * range resolves to, how many bytes the response promises, and where the
 * bytes come from. The stream mechanics live in `media-stream.test.ts`; here
 * the client is a synthetic file, so a wrong offset shows up as wrong bytes.
 */

const SIZE = 10_000;
const CHUNK = 1000;

function byteAt(at: number): number {
  return at % 251;
}

/**
 * The bytes of the synthetic file in `[from, from + count)`.
 */
function bytesAt(from: number, count: number): Uint8Array {
  return Uint8Array.from({ length: count }, (_, index) => byteAt(from + index));
}

const VIDEO = {
  type: 'video',
  mimeType: 'video/mp4',
  fileSize: SIZE,
  thumbnails: [{ isVideo: false, fileSize: 50 }],
};

const PHOTO = { type: 'photo', fileSize: SIZE, thumbnails: [] as unknown[] };

/**
 * A client whose `downloadAsIterable` serves the synthetic file from the
 * requested offset, recording every download's params. `size` defaults to the
 * module's small fixture so cases that need to cross a 1 MB part block can
 * pass their own.
 */
function fakeClient(media: unknown, peer: unknown = null, size = SIZE): { client: TelegramClient; requests: DownloadParams[] } {
  const requests: DownloadParams[] = [];
  const client = {
    async getMessages(): Promise<unknown[]> {
      return [{ media }];
    },
    async getPeer(): Promise<unknown> {
      return peer;
    },
    downloadAsIterable(_location: FileLocation, params: DownloadParams) {
      requests.push(params);
      const start = params.offset ?? 0;
      return (async function* () {
        for (let at = start; at < size; at += CHUNK) {
          const chunk = bytesAt(at, Math.min(CHUNK, size - at));
          await params.throttle?.(chunk.byteLength);
          yield chunk;
        }
      })();
    },
  };
  return { client: client as unknown as TelegramClient, requests };
}

async function body(download: { stream: ReadableStream<Uint8Array> }): Promise<Uint8Array> {
  return new Uint8Array(await new Response(download.stream).arrayBuffer());
}

describe('streamMessageMedia', () => {
  it('serves a whole video with its exact size', async () => {
    const { client, requests } = fakeClient(VIDEO);
    const download = await streamMessageMedia(client, 1, 2);

    expect(download).toMatchObject({ mime: 'video/mp4', size: SIZE, length: SIZE, status: 200, contentRange: null });
    await expect(body(download)).resolves.toEqual(bytesAt(0, SIZE));
    expect(requests[0]).toMatchObject({ offset: 0, fileSize: SIZE });
  });

  it('answers a bounded range with the requested bytes and 206 metadata', async () => {
    const { client, requests } = fakeClient(VIDEO);
    const download = await streamMessageMedia(client, 1, 2, { range: { start: 5, end: 9 } });

    expect(download).toMatchObject({ status: 206, length: 5, contentRange: `bytes 5-9/${SIZE}` });
    await expect(body(download)).resolves.toEqual(bytesAt(5, 5));
    expect(requests[0]?.offset).toBe(0);
  });

  it('serves an open-ended tail range from the aligned offset', async () => {
    const { client, requests } = fakeClient(VIDEO);
    const download = await streamMessageMedia(client, 1, 2, { range: { start: 5000, end: null } });

    expect(download).toMatchObject({ status: 206, length: 5000, contentRange: `bytes 5000-9999/${SIZE}` });
    await expect(body(download)).resolves.toEqual(bytesAt(5000, 5000));
    // Telegram parts must start on a 1 MB block; the extra prefix is dropped.
    expect(requests[0]?.offset).toBe(0);
  });

  it('starts a mid-file range on a 1 MB part block', async () => {
    // The shape that produced `LIMIT_INVALID`: the browser seeks 64 KB before
    // the second 1 MB boundary. A merely 4 KB-aligned offset let mtcute's
    // first 128 KB part cross that boundary, which Telegram rejects.
    const size = 3 * 1024 * 1024;
    const start = 1024 * 1024 + 983_040;
    const { client, requests } = fakeClient({ ...VIDEO, fileSize: size }, null, size);

    const download = await streamMessageMedia(client, 1, 2, { range: { start, end: start + 99 } });

    expect(download).toMatchObject({
      status: 206,
      length: 100,
      contentRange: `bytes ${start}-${start + 99}/${size}`,
    });
    // The part block below the request, not the request's own 4 KB alignment.
    expect(requests[0]?.offset).toBe(1024 * 1024);
    await expect(body(download)).resolves.toEqual(bytesAt(start, 100));
  });

  it('rejects a range that starts past the file', async () => {
    const { client } = fakeClient(VIDEO);
    await expect(streamMessageMedia(client, 1, 2, { range: { start: SIZE, end: null } })).rejects.toThrow('outside the file');
  });

  it('serves photos whole, with no content-length promise', async () => {
    const { client } = fakeClient(PHOTO);
    // A range on a photo falls back to the full file: the size list is good
    // for bounds, not for a `content-range`.
    const download = await streamMessageMedia(client, 1, 2, { range: { start: 5, end: 9 } });

    expect(download).toMatchObject({ mime: 'image/jpeg', size: null, length: null, status: 200, contentRange: null });
    await expect(body(download)).resolves.toEqual(bytesAt(0, SIZE));
  });

  it('streams the thumbnail for a poster request', async () => {
    const { client, requests } = fakeClient(VIDEO);
    const download = await streamMessageMedia(client, 1, 2, { thumb: true });

    expect(download).toMatchObject({ mime: 'image/jpeg', size: null, length: null, status: 200 });
    // The thumbnail location, not the video's.
    expect(requests[0]?.fileSize).toBe(50);
  });
});

describe('readAvatar', () => {
  it('reads the requested profile photo size whole, with its version token', async () => {
    const photo = { small: { fileSize: 40, uniqueFileId: 'small-1' }, big: { fileSize: 50, uniqueFileId: 'big-1' } };
    const { client, requests } = fakeClient(PHOTO, { photo });

    const avatar = await readAvatar(client, 1, 'big');

    expect(avatar.mime).toBe('image/jpeg');
    expect(avatar.version).toBe('big-1');
    expect(avatar.bytes.byteLength).toBe(SIZE);
    // The whole photo, not a window of it.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.offset).toBeUndefined();
  });

  it('names the photo without reading its bytes', async () => {
    const photo = { small: { fileSize: 40, uniqueFileId: 'small-1' }, big: { fileSize: 50, uniqueFileId: 'big-1' } };
    const { client, requests } = fakeClient(PHOTO, { photo });

    expect(await readAvatarVersion(client, 1, 'small')).toBe('small-1');
    // The version identifies the bytes without fetching them.
    expect(requests).toHaveLength(0);
  });
});
