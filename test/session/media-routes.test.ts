import { describe, expect, it, vi } from 'vitest';
import type { TelegramDriver } from '../../worker/src/session/driver';
import { EngineError } from '../../worker/src/session/errors';
import type { MediaDownload } from '../../worker/src/session/media';
import { avatarResponse, fileResponse } from '../../worker/src/session/media-routes';

/**
 * The HTTP half of `/api/file` and `/api/avatar`: which `Range` forms reach the
 * download, and which headers make a `<video>` seek. The engine test suite
 * covers the malformed-coordinate 400s; these cases lock the 200/206 contract.
 */

function download(overrides: Partial<MediaDownload> = {}): MediaDownload {
  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    }),
    mime: 'video/mp4',
    size: 1000,
    length: 4,
    status: 200,
    contentRange: null,
    ...overrides,
  };
}

function stubDriver(media: MediaDownload): { driver: TelegramDriver; streamMessageMedia: ReturnType<typeof vi.fn> } {
  const streamMessageMedia = vi.fn(async () => media);
  return { driver: { streamMessageMedia } as unknown as TelegramDriver, streamMessageMedia };
}

function target(path: string, headers: Record<string, string> = {}): { request: Request; url: URL } {
  const url = new URL(`https://session-engine.internal${path}`);
  return { request: new Request(url, { headers }), url };
}

describe('fileResponse', () => {
  it('serves a whole file with range support advertised', async () => {
    const { driver, streamMessageMedia } = stubDriver(download());
    const { request, url } = target('/api/file?chatId=1&messageId=2');

    const response = await fileResponse(driver, request, url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(streamMessageMedia).toHaveBeenCalledWith(1, 2, {});
  });

  it('forwards a bounded range and its 206 metadata', async () => {
    const media = download({ status: 206, length: 100, contentRange: 'bytes 100-199/1000' });
    const { driver, streamMessageMedia } = stubDriver(media);
    const { request, url } = target('/api/file?chatId=1&messageId=2', { range: 'bytes=100-199' });

    const response = await fileResponse(driver, request, url);

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(streamMessageMedia).toHaveBeenCalledWith(1, 2, { range: { start: 100, end: 199 } });
  });

  it('forwards an open-ended range, the form a seeking player sends', async () => {
    const { driver, streamMessageMedia } = stubDriver(download({ status: 206, length: 600, contentRange: 'bytes 400-999/1000' }));
    const { request, url } = target('/api/file?chatId=1&messageId=2', { range: 'bytes=400-' });

    await fileResponse(driver, request, url);

    expect(streamMessageMedia).toHaveBeenCalledWith(1, 2, { range: { start: 400, end: null } });
  });

  it('ignores malformed and multi-part ranges instead of failing the player', async () => {
    const ranges = ['bytes=abc', 'bytes=0-1,5-9', 'items=0-1', 'bytes=10-5'];
    for (const range of ranges) {
      const { driver, streamMessageMedia } = stubDriver(download());
      const { request, url } = target('/api/file?chatId=1&messageId=2', { range });
      const response = await fileResponse(driver, request, url);
      expect(response.status, range).toBe(200);
      expect(streamMessageMedia, range).toHaveBeenCalledWith(1, 2, {});
    }
  });

  it('answers a poster request from the thumbnail', async () => {
    const { driver, streamMessageMedia } = stubDriver(download({ mime: 'image/jpeg', length: null }));
    const { request, url } = target('/api/file?chatId=1&messageId=2&thumb=1');

    const response = await fileResponse(driver, request, url);

    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-length')).toBeNull();
    expect(streamMessageMedia).toHaveBeenCalledWith(1, 2, { thumb: true });
  });

  it('propagates a range outside the file for the engine to 416', async () => {
    const streamMessageMedia = vi.fn(async () => {
      throw new EngineError('Requested range is outside the file', 416);
    });
    const driver = { streamMessageMedia } as unknown as TelegramDriver;
    const { request, url } = target('/api/file?chatId=1&messageId=2', { range: 'bytes=5000-' });

    await expect(fileResponse(driver, request, url)).rejects.toMatchObject({ status: 416 });
  });
});

describe('avatarResponse', () => {
  it('resolves the requested size and caches for a day', async () => {
    const streamAvatar = vi.fn(async () => download({ mime: 'image/jpeg', size: null, length: null }));
    const driver = { streamAvatar } as unknown as TelegramDriver;
    const { url } = target('/api/avatar?chatId=7&size=big');

    const response = await avatarResponse(driver, url);

    expect(streamAvatar).toHaveBeenCalledWith(7, 'big');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400');
    // No exact size, so no range promises.
    expect(response.headers.get('accept-ranges')).toBeNull();
  });
});
