import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDto, MessageDto, StickerDto } from '../../apps/web/src/types';
import type { ChatThread } from '../../apps/web/src/thread-state';

const api = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendSticker: vi.fn(),
}));
const uploader = vi.hoisted(() => ({
  sendUploadBatch: vi.fn(),
}));

vi.mock('../../apps/web/src/api', () => api);
vi.mock('../../apps/web/src/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/src/upload')>();
  return { ...actual, ...uploader };
});

const { useThreadSends } = await import('../../apps/web/src/useThreadSends');

function chat(id = 2): ChatDto {
  return {
    id,
    kind: 'user',
    title: 'Ada',
    username: null,
    photo: null,
    canSendMessages: true,
    canDeleteMessages: true,
    canPinMessages: true,
    presence: null,
  };
}

function message(id: number): MessageDto {
  return {
    id,
    chatId: 2,
    groupedId: null,
    senderId: 1,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: false,
    date: 0,
    pinned: false,
    editDate: null,
    text: `Message ${String(id)}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    replyTo: null,
    forward: null,
    markup: null,
    views: null,
    comments: null,
  } as unknown as MessageDto;
}

function thread(): ChatThread {
  return {
    chat: chat(),
    messages: [message(3)],
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    unreadDividerId: null,
    focusMessageId: null,
    hasMoreOlder: false,
    windowEndId: 3,
    latestMessageId: 3,
  } as unknown as ChatThread;
}

const sticker: StickerDto = {
  id: '7',
  emoji: '🙂',
  kind: 'static',
  width: 512,
  height: 512,
  thumb: null,
} as unknown as StickerDto;

describe('useThreadSends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setup(current: ChatThread | null) {
    const outbox = {
      send: vi.fn(),
      attach: vi.fn(),
      sendSticker: vi.fn(),
    };
    const onSent = vi.fn();
    const setThread = vi.fn();
    const hook = renderHook(() => useThreadSends({ thread: current, outbox: outbox as never, setThread, onSent }));
    return { ...hook, outbox, onSent, setThread };
  }

  it('hands a text send to the outbox with its reply preview', async () => {
    const { result, outbox } = setup(thread());
    await result.current.send('Hello', 3);

    const entry = outbox.send.mock.calls[0]?.[0];
    expect(entry).toMatchObject({ chatId: 2, scope: '2', text: 'Hello', replyTo: 3 });
    expect(entry.replyPreview?.id).toBe(3);

    api.sendMessage.mockResolvedValueOnce({ message: message(9) });
    const delivered = await entry.deliver({ kind: 'text', text: 'Hello' }, ['11']);
    expect(api.sendMessage).toHaveBeenCalledWith(2, 'Hello', undefined, '11');
    expect(delivered).toHaveLength(1);

    entry.onSettled(delivered);
    expect(outbox.send).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an open thread', async () => {
    const { result, outbox } = setup(null);
    await result.current.send('Hello');
    await result.current.attach({ files: [], caption: '', grouped: false, sendAsFile: false });
    await result.current.sendSticker(sticker, null);
    expect(outbox.send).not.toHaveBeenCalled();
    expect(outbox.attach).not.toHaveBeenCalled();
    expect(outbox.sendSticker).not.toHaveBeenCalled();
  });

  it('chains an attachment through the upload batch and its progress', async () => {
    const { result, outbox, onSent } = setup(thread());
    const request = { files: [], caption: 'Look', replyTo: 3, grouped: false, sendAsFile: false };
    await result.current.attach(request);

    const entry = outbox.attach.mock.calls[0]?.[0];
    expect(entry).toMatchObject({ chatId: 2, scope: '2', request });
    expect(entry.replyPreview?.id).toBe(3);

    uploader.sendUploadBatch.mockImplementationOnce(async (_destination, _request, onProgress, onMessage) => {
      onProgress(0.5);
      onMessage(message(10));
    });
    const messages = await entry.deliver({ kind: 'file', request }, ['12'], vi.fn());
    expect(messages).toHaveLength(1);

    entry.onSettled(messages);
    expect(onSent).toHaveBeenCalledWith(messages.at(-1));
  });

  it('sends a sticker with the pack identity and the reply target', async () => {
    const { result, outbox } = setup(thread());
    await result.current.sendSticker(sticker, { id: '10', accessHash: '100' }, 3);

    const entry = outbox.sendSticker.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      chatId: 2,
      scope: '2',
      sticker,
      set: { id: '10', accessHash: '100' },
      replyTo: 3,
    });
    expect(entry.replyPreview?.id).toBe(3);

    api.sendSticker.mockResolvedValueOnce({ message: message(9) });
    const delivered = await entry.deliver({ kind: 'sticker', documentId: '7', set: { id: '10', accessHash: '100' }, replyTo: 3 }, ['13']);
    expect(api.sendSticker).toHaveBeenCalledWith(2, '7', {
      replyTo: 3,
      randomId: '13',
      set: { id: '10', accessHash: '100' },
    });
    expect(delivered).toHaveLength(1);
  });

  it('sends a sticker with no reply and no pack identity', async () => {
    const { result, outbox } = setup(thread());
    await result.current.sendSticker(sticker, null);

    const entry = outbox.sendSticker.mock.calls[0]?.[0];
    expect(entry.replyPreview).toBeNull();

    api.sendSticker.mockResolvedValueOnce({ message: message(9) });
    await entry.deliver({ kind: 'sticker', documentId: '7' }, []);
    expect(api.sendSticker).toHaveBeenCalledWith(2, '7', {});
  });
});
