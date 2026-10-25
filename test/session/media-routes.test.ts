import { describe, expect, it, vi } from 'vitest';
import type { AvatarCache } from '../../packages/backend-services/src/session/avatar-cache';
import type { TelegramDriver } from '../../packages/backend-services/src/session/driver';
import { EngineError } from '../../packages/backend-services/src/session/errors';
import type { MediaDownload } from '../../packages/backend-services/src/session/media';
import { avatarResponse, fileResponse, uploadGroupResponse } from '../../packages/backend-services/src/session/media-routes';
import type { UploadGroupSpec } from '../../packages/backend-services/src/session/upload-spec';

/**
 * The HTTP half of `/user/file` and `/user/avatar`: which `Range` forms reach the
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
    const { request, url } = target('/user/file?chatId=1&messageId=2');

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
    const { request, url } = target('/user/file?chatId=1&messageId=2', { range: 'bytes=100-199' });

    const response = await fileResponse(driver, request, url);

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(streamMessageMedia).toHaveBeenCalledWith(1, 2, { range: { start: 100, end: 199 } });
  });

  it('forwards an open-ended range, the form a seeking player sends', async () => {
    const { driver, streamMessageMedia } = stubDriver(download({ status: 206, length: 600, contentRange: 'bytes 400-999/1000' }));
    const { request, url } = target('/user/file?chatId=1&messageId=2', { range: 'bytes=400-' });

    await fileResponse(driver, request, url);

    expect(streamMessageMedia).toHaveBeenCalledWith(1, 2, { range: { start: 400, end: null } });
  });

  it('ignores malformed and multi-part ranges instead of failing the player', async () => {
    const ranges = ['bytes=abc', 'bytes=0-1,5-9', 'items=0-1', 'bytes=10-5'];
    for (const range of ranges) {
      const { driver, streamMessageMedia } = stubDriver(download());
      const { request, url } = target('/user/file?chatId=1&messageId=2', { range });
      const response = await fileResponse(driver, request, url);
      expect(response.status, range).toBe(200);
      expect(streamMessageMedia, range).toHaveBeenCalledWith(1, 2, {});
    }
  });

  it('answers a poster request from the thumbnail', async () => {
    const { driver, streamMessageMedia } = stubDriver(download({ mime: 'image/jpeg', length: null }));
    const { request, url } = target('/user/file?chatId=1&messageId=2&thumb=1');

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
    const { request, url } = target('/user/file?chatId=1&messageId=2', { range: 'bytes=5000-' });

    await expect(fileResponse(driver, request, url)).rejects.toMatchObject({ status: 416 });
  });
});

describe('uploadGroupResponse', () => {
  it('parses the manifest, hands the raw body to the driver and returns every message', async () => {
    const manifest = Buffer.from(
      JSON.stringify([
        { kind: 'document', size: 2, fileName: 'a.txt', mime: 'text/plain' },
        { kind: 'document', size: 3, fileName: 'b.txt', mime: 'text/plain' },
      ]),
    ).toString('base64url');
    const sendUploadGroup = vi.fn(async (_spec: UploadGroupSpec, _body: ReadableStream<Uint8Array>) => [{ id: 2 }, { id: 1 }]);
    const driver = { sendUploadGroup } as unknown as TelegramDriver;
    const { url } = target(`/user/upload-group?chatId=1&manifest=${manifest}`);
    const upload = new Request(url, { method: 'POST', body: 'abcde', headers: { 'content-type': 'application/octet-stream' } });

    const response = await uploadGroupResponse(driver, upload, url, { maxUploadBytes: 100 });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ messages: [{ id: 2 }, { id: 1 }] });
    expect(sendUploadGroup).toHaveBeenCalledTimes(1);
    expect(sendUploadGroup.mock.calls[0]?.[0]).toMatchObject({
      chatId: 1,
      items: [
        { kind: 'document', size: 2, fileName: 'a.txt' },
        { kind: 'document', size: 3, fileName: 'b.txt' },
      ],
    });
    // The route passes the live request stream, not a buffered copy.
    expect(sendUploadGroup.mock.calls[0]?.[1]).toBe(upload.body);
  });

  it('400s an invalid manifest before the driver sees it', async () => {
    const sendUploadGroup = vi.fn();
    const driver = { sendUploadGroup } as unknown as TelegramDriver;
    const { url } = target('/user/upload-group?chatId=1&manifest=!!!');
    const upload = new Request(url, { method: 'POST', body: 'x' });

    await expect(uploadGroupResponse(driver, upload, url, { maxUploadBytes: 100 })).rejects.toMatchObject({ status: 400 });
    expect(sendUploadGroup).not.toHaveBeenCalled();
  });
});

describe('avatarResponse', () => {
  /**
   * A cache the test can inspect: the real one is the engine's SQLite.
   */
  function fakeCache(): { cache: AvatarCache; stored: Map<string, string> } {
    const stored = new Map<string, string>();
    const cache = {
      read: (version: string, size: string) => {
        const bytes = stored.get(`${version}:${size}`);
        return bytes === undefined ? null : { mime: 'image/jpeg', bytes: new TextEncoder().encode(bytes) };
      },
      write: (version: string, size: string, _mime: string, bytes: Uint8Array): void => {
        stored.set(`${version}:${size}`, new TextDecoder().decode(bytes));
      },
    } as unknown as AvatarCache;
    return { cache, stored };
  }

  it('serves the cached bytes and keeps them for a day', async () => {
    const readAvatarVersion = vi.fn(async () => 'version-1');
    const readAvatar = vi.fn(async () => ({ mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]), version: 'version-1' }));
    const driver = { readAvatarVersion, readAvatar } as unknown as TelegramDriver;
    const { cache, stored } = fakeCache();
    const { url } = target('/user/avatar?chatId=7&size=big');

    const response = await avatarResponse(driver, cache, url);

    expect(readAvatarVersion).toHaveBeenCalledWith(7, 'big');
    expect(readAvatar).toHaveBeenCalledWith(7, 'big');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    // The bytes are kept, so the next request never reaches Telegram again.
    expect(stored.has('version-1:big')).toBe(true);
  });

  it('answers from the cache without asking Telegram for the bytes', async () => {
    const readAvatarVersion = vi.fn(async () => 'version-1');
    const readAvatar = vi.fn(async () => ({ mime: 'image/jpeg', bytes: new Uint8Array([1]), version: 'version-1' }));
    const driver = { readAvatarVersion, readAvatar } as unknown as TelegramDriver;
    const { cache } = fakeCache();
    const { url } = target('/user/avatar?chatId=7&size=small');
    await avatarResponse(driver, cache, url);

    const cached = await avatarResponse(driver, cache, url);

    expect(readAvatar).toHaveBeenCalledTimes(1);
    expect(cached.headers.get('content-type')).toBe('image/jpeg');
  });
});
