import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageDto } from '../../apps/web/src/types';

const deleteMessages = vi.fn<(chatId: number, messageIds: readonly number[]) => Promise<void>>();

vi.mock('../../apps/web/src/api', () => ({ deleteMessages }));

const { useMessageDelete } = await import('../../apps/web/src/useMessageDelete');

function message(id: number): MessageDto {
  return {
    id,
    chatId: 1,
    groupedId: null,
    senderId: 1,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: true,
    date: 1_700_000_000_000,
    editDate: null,
    text: `message ${id}`,
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
  };
}

beforeEach(() => {
  deleteMessages.mockReset();
  deleteMessages.mockResolvedValue(undefined);
});

describe('useMessageDelete', () => {
  it('opens on request and deletes the confirmed group for everyone at once', async () => {
    const remove = vi.fn();
    const restore = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useMessageDelete({ remove, restore, onError }));

    act(() => result.current.request([message(10), message(11)]));
    expect(result.current.messages?.map((entry) => entry.id)).toEqual([10, 11]);

    await act(async () => result.current.confirm());

    // The rows leave before Telegram answers, and the engine's echo repairs
    // the list, so success touches nothing else.
    expect(remove).toHaveBeenCalledWith(1, [10, 11]);
    expect(restore).not.toHaveBeenCalled();
    expect(deleteMessages).toHaveBeenCalledWith(1, [10, 11]);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.messages).toBeNull();
  });

  it('puts the group back and reports a refused delete', async () => {
    const failure = new Error('nope');
    deleteMessages.mockRejectedValue(failure);
    const remove = vi.fn();
    const restore = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useMessageDelete({ remove, restore, onError }));

    act(() => result.current.request([message(10)]));
    await act(async () => result.current.confirm());

    expect(restore).toHaveBeenCalledWith([message(10)]);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('cancels without sending anything', () => {
    const remove = vi.fn();
    const { result } = renderHook(() => useMessageDelete({ remove, restore: vi.fn(), onError: vi.fn() }));

    act(() => result.current.request([message(10)]));
    act(() => result.current.cancel());

    expect(result.current.messages).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(deleteMessages).not.toHaveBeenCalled();
  });

  it('ignores an empty request and a confirm with nothing pending', () => {
    const { result } = renderHook(() => useMessageDelete({ remove: vi.fn(), restore: vi.fn(), onError: vi.fn() }));

    act(() => result.current.request([]));
    act(() => result.current.confirm());

    expect(result.current.messages).toBeNull();
    expect(deleteMessages).not.toHaveBeenCalled();
  });
});
