import type { InputMediaLike } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it, vi } from 'vitest';
import { UploadBodySplitter, sendUploadedMediaGroup } from '../../packages/backend-services/src/session/upload';

vi.mock('../../packages/backend-services/src/session/dto', () => ({
  toMessageDto: (message: { id: number }) => ({ id: message.id }),
}));

/**
 * The album send is a streaming problem, not an HTTP problem: one request body
 * has to become N exact byte ranges in the order mtcute consumes them. These
 * tests pin the splitter's bounds and the order/caption contract of the send.
 */

function stream(chunks: readonly (readonly number[])[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<number[]> {
  const reader = body.getReader();
  const bytes: number[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return bytes;
    bytes.push(...value);
  }
}

function mediaFile(media: InputMediaLike): ReadableStream<Uint8Array> {
  const file = (media as { file?: unknown }).file;
  if (!(file instanceof ReadableStream)) throw new Error('expected a stream-backed media');
  return file as ReadableStream<Uint8Array>;
}

function mediaInfo(media: InputMediaLike): { type: string; caption?: string } {
  const record = media as { type?: string; caption?: string };
  return {
    type: record.type ?? '',
    ...(record.caption !== undefined && { caption: record.caption }),
  };
}

describe('UploadBodySplitter', () => {
  it('cuts the concatenated body into the declared sizes across chunk boundaries', async () => {
    const splitter = new UploadBodySplitter(stream([[1, 2], [3, 4, 5], [6]]));
    const first = splitter.part(0, 2);
    const second = splitter.part(1, 3);
    const third = splitter.part(2, 1);

    await expect(readAll(first)).resolves.toEqual([1, 2]);
    await expect(readAll(second)).resolves.toEqual([3, 4, 5]);
    await expect(readAll(third)).resolves.toEqual([6]);
    splitter.dispose();
  });

  it('refuses to read an item before the previous one finished', async () => {
    const splitter = new UploadBodySplitter(stream([[1], [2]]));
    const first = splitter.part(0, 1);
    const second = splitter.part(1, 1);

    await expect(readAll(second)).rejects.toMatchObject({ status: 400 });
    splitter.dispose();
    // Keep the first stream from being left unread in the test.
    await first.cancel().catch(() => {});
  });

  it('fails when the body ends before every declared item is complete', async () => {
    const splitter = new UploadBodySplitter(stream([[1, 2, 3]]));
    const part = splitter.part(0, 4);

    await expect(readAll(part)).rejects.toMatchObject({ status: 400 });
    splitter.dispose();
  });

  it('requires the parts to be created in manifest order', () => {
    const splitter = new UploadBodySplitter(stream([[1]]));
    expect(() => splitter.part(1, 1)).toThrowError(expect.objectContaining({ status: 400 }));
    splitter.dispose();
  });
});

describe('sendUploadedMediaGroup', () => {
  it('feeds each attachment its own bytes and captions only the first', async () => {
    const captured: Array<{ type: string; caption?: string; bytes: number[] }> = [];
    const sendMediaGroup = vi.fn(async (_chatId: unknown, medias: InputMediaLike[]) => {
      for (const media of medias) {
        captured.push({
          ...mediaInfo(media),
          bytes: await readAll(mediaFile(media)),
        });
      }
      return [{ id: 2 }, { id: 1 }];
    });
    const client = { sendMediaGroup } as unknown as TelegramClient;

    const messages = await sendUploadedMediaGroup(
      client,
      {
        chatId: 10,
        caption: 'Album',
        items: [
          { kind: 'document', size: 2, fileName: 'a.txt', mime: 'text/plain' },
          { kind: 'document', size: 3, fileName: 'b.txt', mime: 'text/plain' },
        ],
      },
      stream([
        [1, 2],
        [3, 4, 5],
      ]),
    );

    expect(sendMediaGroup).toHaveBeenCalledTimes(1);
    expect(captured).toEqual([
      { type: 'document', caption: 'Album', bytes: [1, 2] },
      { type: 'document', bytes: [3, 4, 5] },
    ]);
    expect(messages.map((message) => message.id)).toEqual([1, 2]);
  });

  it('maps animation to the video media type that mtcute groups', async () => {
    const types: string[] = [];
    const client = {
      sendMediaGroup: vi.fn(async (_chatId: unknown, medias: InputMediaLike[]) => {
        for (const media of medias) {
          types.push(mediaInfo(media).type);
          await readAll(mediaFile(media));
        }
        return [{ id: 1 }, { id: 2 }];
      }),
    } as unknown as TelegramClient;

    await sendUploadedMediaGroup(
      client,
      {
        chatId: 10,
        items: [
          { kind: 'animation', size: 1, fileName: 'a.gif', mime: 'image/gif' },
          { kind: 'video', size: 1, fileName: 'b.mp4', mime: 'video/mp4' },
        ],
      },
      stream([[1], [2]]),
    );

    expect(types).toEqual(['video', 'video']);
  });
});
