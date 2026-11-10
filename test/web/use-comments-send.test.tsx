import { act, cleanup, renderHook } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentsThread } from '../../apps/web/src/state';
import type { MessageDto, MessageReactionDto } from '../../apps/web/src/types';

/**
 * The comments screen's write half: the optimistic outbox behind sends and
 * attachments, and the reaction toggle. The outbox itself is faked here so the
 * test sees exactly the delivery and settlement it hands back.
 */

const api = vi.hoisted(() => ({ sendComment: vi.fn(), sendReaction: vi.fn() }));
const upload = vi.hoisted(() => ({ sendUploadBatch: vi.fn() }));
const outbox = vi.hoisted(() => ({
  pending: [],
  send: vi.fn(),
  attach: vi.fn(),
  retry: vi.fn(),
  discard: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('../../apps/web/src/api', () => api);
vi.mock('../../apps/web/src/upload', () => upload);
vi.mock('../../apps/web/src/useOutbox', () => ({ useOutbox: () => outbox }));

const { useCommentsSend } = await import('../../apps/web/src/useCommentsSend');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function message(id: number, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id,
    chatId: 100,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000 + id,
    text: `comment ${String(id)}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: null,
    markup: null,
    replyKeyboard: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
    ...overrides,
  };
}

function thread(overrides: Partial<CommentsThread> = {}): CommentsThread {
  return {
    chat: {
      id: 2,
      kind: 'channel',
      title: 'Channel',
      username: 'channel',
      photo: null,
      canSendMessages: true,
      presence: null,
    },
    post: message(10, { chatId: 2 }),
    discussionChatId: 100,
    discussionMessageId: 500,
    botCommands: [],
    comments: [message(1)],
    count: 1,
    nextOffset: null,
    newMessageIds: new Set(),
    ...overrides,
  };
}

interface Harness {
  thread: CommentsThread | null;
  setThread: Dispatch<SetStateAction<CommentsThread | null>>;
  refresh: ReturnType<typeof vi.fn>;
  onCommentSent: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  current: () => CommentsThread | null;
  result: ReturnType<typeof renderHook<ReturnType<typeof useCommentsSend>, unknown>>['result'];
}

function harness(initial: CommentsThread | null = thread()): Harness {
  let state = initial;
  const setThread: Dispatch<SetStateAction<CommentsThread | null>> = (update) => {
    state = typeof update === 'function' ? (update as (current: CommentsThread | null) => CommentsThread | null)(state) : update;
  };
  const refresh = vi.fn(async () => {});
  const onCommentSent = vi.fn();
  const onError = vi.fn();
  const { result } = renderHook(() =>
    useCommentsSend({
      thread: initial,
      setThread,
      refresh,
      onCommentSent,
      onError,
    }),
  );
  return {
    thread: initial,
    setThread,
    refresh,
    onCommentSent,
    onError,
    current: () => state,
    result,
  };
}

describe('useCommentsSend', () => {
  it('enqueues a comment against the discussion group', async () => {
    const test = harness();

    await test.result.current.send('Hello', 1);

    expect(outbox.send).toHaveBeenCalledOnce();
    const input = outbox.send.mock.calls[0]![0];
    expect(input).toMatchObject({ chatId: 100, scope: '2:10', text: 'Hello', replyTo: 1 });
    expect(input.replyPreview).toEqual(message(1));
  });

  it('delivers the text through sendComment and merges the answer', async () => {
    const test = harness();
    api.sendComment.mockResolvedValue({ message: message(2) });
    await test.result.current.send('Hello');

    const input = outbox.send.mock.calls[0]![0];
    const delivered = await input.deliver({ kind: 'text', text: 'Hello' }, ['random']);

    expect(api.sendComment).toHaveBeenCalledWith(2, 10, 'Hello', undefined, 'random');
    expect(delivered).toEqual([message(2)]);

    input.onSettled(delivered);

    expect(test.current()?.comments.map((comment) => comment.id)).toEqual([1, 2]);
    expect(test.current()?.count).toBe(2);
    expect(test.current()?.newMessageIds.has(2)).toBe(true);
    expect(test.onCommentSent).toHaveBeenCalledWith(2, 10, message(2));
    expect(test.refresh).not.toHaveBeenCalled();
  });

  it('re-reads the thread after the first comment creates the discussion', async () => {
    const test = harness(thread({ discussionChatId: null, discussionMessageId: null }));
    api.sendComment.mockResolvedValue({ message: message(2) });
    await test.result.current.send('First');

    const input = outbox.send.mock.calls[0]![0];
    expect(input.chatId).toBe(2);
    const delivered = await input.deliver({ kind: 'text', text: 'First' }, ['random']);
    input.onSettled(delivered);

    expect(test.refresh).toHaveBeenCalledWith({ chatId: 2, messageId: 10 });
  });

  it('does not count a comment the socket already delivered', async () => {
    const test = harness(thread({ comments: [message(1), message(2)], count: 2 }));
    api.sendComment.mockResolvedValue({ message: message(2) });
    await test.result.current.send('Hello');

    const input = outbox.send.mock.calls[0]![0];
    const delivered = await input.deliver({ kind: 'text', text: 'Hello' }, ['random']);
    input.onSettled(delivered);

    expect(test.current()?.comments).toHaveLength(2);
    expect(test.current()?.count).toBe(2);
  });

  it('does nothing when the comments screen is closed', async () => {
    const test = harness(null);

    await test.result.current.send('Hello');
    await test.result.current.attach({ files: [], caption: '', grouped: false, sendAsFile: false });

    expect(outbox.send).not.toHaveBeenCalled();
    expect(outbox.attach).not.toHaveBeenCalled();
  });

  it('delivers an attachment through sendUploadBatch and reports progress', async () => {
    const test = harness();
    const request = { files: [new File(['x'], 'a.png', { type: 'image/png' })], caption: 'pic', grouped: false, sendAsFile: false };
    upload.sendUploadBatch.mockImplementation(async (_destination, _request, onProgress, onComment) => {
      onProgress(0.5);
      onComment(message(3));
    });

    await test.result.current.attach(request);

    expect(outbox.attach).toHaveBeenCalledOnce();
    const input = outbox.attach.mock.calls[0]![0];
    expect(input).toMatchObject({ chatId: 100, scope: '2:10' });

    const onProgress = vi.fn();
    const delivered = await input.deliver({ kind: 'file', request }, ['r1'], onProgress);

    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(upload.sendUploadBatch).toHaveBeenCalledWith({ chatId: 2, commentTo: 10 }, request, expect.any(Function), expect.any(Function), [
      'r1',
    ]);
    expect(delivered).toEqual([message(3)]);
  });

  it('toggles a reaction optimistically and folds in the answer', async () => {
    const test = harness();
    api.sendReaction.mockResolvedValue({
      message: message(1, { reactions: [{ emoji: '❤️', customEmojiId: null, count: 1, chosen: true }] }),
    });
    const reaction: MessageReactionDto = { emoji: '❤️', customEmojiId: null, count: 0, chosen: false };

    test.result.current.react(message(1), reaction);

    expect(test.current()?.comments[0]?.reactions).toEqual([{ emoji: '❤️', customEmojiId: null, count: 1, chosen: true }]);
    expect(api.sendReaction).toHaveBeenCalledWith(100, 1, { emoji: '❤️' });

    await vi.waitFor(() => expect(test.current()?.comments[0]?.reactions[0]?.chosen).toBe(true));
  });

  it('retracts a chosen reaction with a null target', async () => {
    const test = harness();
    api.sendReaction.mockResolvedValue({ message: null });
    const reaction: MessageReactionDto = { emoji: '❤️', customEmojiId: null, count: 1, chosen: true };

    test.result.current.react(message(1), reaction);

    expect(api.sendReaction).toHaveBeenCalledWith(100, 1, null);
  });

  it('rolls a failed reaction back and reports it', async () => {
    const test = harness();
    api.sendReaction.mockRejectedValue(new Error('offline'));
    const before: MessageReactionDto[] = [{ emoji: '❤️', customEmojiId: null, count: 1, chosen: true }];
    const target = message(1, { reactions: before });

    test.result.current.react(target, { emoji: '❤️', customEmojiId: null, count: 1, chosen: true });

    await vi.waitFor(() => expect(test.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' })));
    expect(test.current()?.comments[0]?.reactions).toEqual(before);
  });

  it('ignores a reaction with nothing to send or one already in flight', () => {
    const test = harness();

    act(() => test.result.current.react(message(1), { emoji: null, customEmojiId: null, count: 0, chosen: false }));
    act(() => test.result.current.react(message(1), { emoji: '❤️', customEmojiId: null, count: 0, chosen: false }));
    act(() => test.result.current.react(message(1), { emoji: '❤️', customEmojiId: null, count: 1, chosen: true }));

    expect(api.sendReaction).toHaveBeenCalledTimes(1);
  });

  it('delegates retry, discard and clear to the outbox', () => {
    const test = harness();

    test.result.current.retryPending('key');
    test.result.current.discardPending('key');
    test.result.current.clearPending();

    expect(outbox.retry).toHaveBeenCalledWith('key');
    expect(outbox.discard).toHaveBeenCalledWith('key');
    expect(outbox.clear).toHaveBeenCalledOnce();
  });
});
