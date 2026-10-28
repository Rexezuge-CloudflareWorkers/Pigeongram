import type { InputMediaLike } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import { Long, Message, PeersIndex } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it, vi } from 'vitest';
import { UploadBodySplitter, sendUploadedMedia, sendUploadedMediaGroup } from '../../packages/backend-services/src/session/upload';
import type { UploadGroupSpec, UploadSpec } from '../../packages/backend-services/src/session/upload-spec';

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

/**
 * The comment send is addressed by the thread root, which Telegram returns
 * last in `messages.getDiscussionMessage`'s newest-first window. These tests
 * pin the media paths to that root (and the first-comment fallback).
 */

const CHANNEL_ID = -1_000_000_000_020;
const GROUP_PEER = { _: 'inputPeerChannel', channelId: 30, accessHash: Long.fromNumber(30_000) };

const rawChannel = {
  _: 'channel',
  id: 20,
  title: 'Announcements',
  username: 'announce',
  broadcast: true,
  megagroup: false,
  date: 1_700_000_000,
  accessHash: Long.fromNumber(20_000),
} as unknown as tl.RawChannel;

const rawGroup = {
  ...rawChannel,
  id: 30,
  title: 'Announcements Chat',
  username: undefined,
  broadcast: false,
  megagroup: true,
  accessHash: Long.fromNumber(30_000),
} as unknown as tl.RawChannel;

function commentPost(): Message {
  return new Message(
    {
      _: 'message',
      id: 7,
      peerId: { _: 'peerChannel', channelId: 20 },
      fromId: null,
      date: 1_700_000_000,
      message: 'news',
      out: false,
      replies: { _: 'messageReplies', comments: true, replies: 3, channelId: 30, maxId: 12, recentRepliers: [] },
    } as unknown as tl.RawMessage,
    PeersIndex.from({ users: [], chats: [rawChannel, rawGroup] }),
  );
}

function commentClient(discussion: readonly number[] | null): {
  client: TelegramClient;
  sent: Array<{ peer: unknown; replyTo?: number }>;
  commented: number[];
} {
  const sent: Array<{ peer: unknown; replyTo?: number }> = [];
  const commented: number[] = [];
  const client = {
    resolvePeer: async () => ({ _: 'inputPeerChannel', channelId: 20, accessHash: Long.fromNumber(20_000) }),
    call: async () => ({
      _: 'messages.discussionMessage',
      messages:
        discussion === null
          ? [{ _: 'messageEmpty', id: 0 }]
          : discussion.map((id) => ({
              _: 'message',
              id,
              peerId: { _: 'peerChannel', channelId: 30 },
              date: 1_700_000_000,
              message: `m${id}`,
              out: false,
            })),
      maxId: discussion?.[0] ?? 0,
      unreadCount: 0,
      chats: [rawGroup],
      users: [],
    }),
    getMessages: async () => [commentPost()],
    sendMedia: async (peer: unknown, _media: unknown, params: { replyTo?: number }) => {
      sent.push({ peer, ...(params.replyTo !== undefined && { replyTo: params.replyTo }) });
      return { id: 98 };
    },
    commentMedia: async () => {
      commented.push(1);
      return { id: 99 };
    },
    sendMediaGroup: async (peer: unknown, _medias: unknown, params: { replyTo?: number }) => {
      sent.push({ peer, ...(params.replyTo !== undefined && { replyTo: params.replyTo }) });
      return [{ id: 98 }];
    },
    commentMediaGroup: async () => {
      commented.push(1);
      return [{ id: 99 }];
    },
  } as unknown as TelegramClient;
  return { client, sent, commented };
}

const singleFile: UploadSpec = {
  chatId: CHANNEL_ID,
  commentTo: 7,
  kind: 'document',
  size: 1,
  fileName: 'a.txt',
  mime: 'text/plain',
};

const album: UploadGroupSpec = {
  chatId: CHANNEL_ID,
  commentTo: 7,
  items: [
    { kind: 'document', size: 1, fileName: 'a.txt', mime: 'text/plain' },
    { kind: 'document', size: 1, fileName: 'b.txt', mime: 'text/plain' },
  ],
};

describe('sendUploadedMedia comments', () => {
  it('posts a top-level comment file at the thread root', async () => {
    const { client, sent, commented } = commentClient([12, 10]);

    const message = await sendUploadedMedia(client, singleFile, stream([[1]]));

    expect(commented).toEqual([]);
    expect(sent).toEqual([{ peer: GROUP_PEER, replyTo: 10 }]);
    expect(message).toEqual({ id: 98 });
  });

  it('falls back to the channel for the first comment file', async () => {
    const { client, sent, commented } = commentClient(null);

    const message = await sendUploadedMedia(client, singleFile, stream([[1]]));

    expect(sent).toEqual([]);
    expect(commented).toEqual([1]);
    expect(message).toEqual({ id: 99 });
  });
});

describe('sendUploadedMediaGroup comments', () => {
  it('posts a top-level comment album at the thread root', async () => {
    const { client, sent, commented } = commentClient([12, 10]);

    const messages = await sendUploadedMediaGroup(client, album, stream([[1], [2]]));

    expect(commented).toEqual([]);
    expect(sent).toEqual([{ peer: GROUP_PEER, replyTo: 10 }]);
    expect(messages).toEqual([{ id: 98 }]);
  });

  it('falls back to the channel for the first comment album', async () => {
    const { client, sent, commented } = commentClient(null);

    const messages = await sendUploadedMediaGroup(client, album, stream([[1], [2]]));

    expect(sent).toEqual([]);
    expect(commented).toEqual([1]);
    expect(messages).toEqual([{ id: 99 }]);
  });
});
