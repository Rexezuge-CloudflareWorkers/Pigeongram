import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageDto } from '../../apps/web/src/types';

const fetchScheduledMessages = vi.fn<() => Promise<{ messages: MessageDto[] }>>();
const sendMessage = vi.fn<() => Promise<{ message: MessageDto; scheduled?: boolean }>>();
const sendScheduled = vi.fn<() => Promise<{ chatId: number; messageIds: number[]; messages: MessageDto[] }>>();
const deleteScheduledMessages = vi.fn<() => Promise<{ chatId: number; messageIds: number[] }>>();

vi.mock('../../apps/web/src/api', () => ({ fetchScheduledMessages, sendMessage, sendScheduled, deleteScheduledMessages }));

const { useScheduledMessages } = await import('../../apps/web/src/useScheduledMessages');

function message(id: number, date = 1_900_000_000_000, text = `queued ${id}`): MessageDto {
  return {
    id,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: null,
    senderPhoto: null,
    outgoing: true,
    date,
    pinned: false,
    editDate: null,
    text,
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

function mount() {
  const onError = vi.fn();
  const onSent = vi.fn();
  const onEdit = vi.fn();
  const hook = renderHook(() => useScheduledMessages({ chatId: 2, enabled: true, onError, onSent, onEdit }));
  return { ...hook, onError, onSent, onEdit };
}

beforeEach(() => {
  fetchScheduledMessages.mockReset();
  sendMessage.mockReset();
  sendScheduled.mockReset();
  deleteScheduledMessages.mockReset();
});

describe('useScheduledMessages', () => {
  it('reads the queue on demand and folds a fresh read by id', async () => {
    fetchScheduledMessages.mockResolvedValueOnce({ messages: [message(2, 20), message(1, 10)] });
    const { result } = mount();
    act(() => result.current.openList());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.messages.map((item) => item.id)).toEqual([1, 2]));
    expect(result.current.loading).toBe(false);
  });

  it('queues a text message and folds the engine answer', async () => {
    const queued = message(3, 1_900_000_100_000);
    sendMessage.mockResolvedValueOnce({ message: queued, scheduled: true });
    const { result } = mount();
    await act(async () => {
      await result.current.schedule('later', 1_900_000_100_000);
    });
    expect(sendMessage).toHaveBeenCalledWith(2, 'later', undefined, expect.stringMatching(/^\d+$/), 1_900_000_100_000);
    expect(result.current.messages.map((item) => item.id)).toEqual([3]);
  });

  it('retires queue rows and folds live copies when a message is sent now', async () => {
    fetchScheduledMessages.mockResolvedValueOnce({ messages: [message(1, 10), message(2, 20)] });
    const sent = message(1, Date.now());
    sendScheduled.mockResolvedValueOnce({ chatId: 2, messageIds: [1], messages: [sent] });
    const { result, onSent } = mount();
    act(() => result.current.openList());
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await act(async () => {
      await result.current.sendNow(result.current.messages[0]);
    });
    expect(sendScheduled).toHaveBeenCalledWith(2, [1]);
    expect(result.current.messages.map((item) => item.id)).toEqual([2]);
    expect(onSent).toHaveBeenCalledWith(sent);
  });

  it('drops a queued message and reports a refusal', async () => {
    fetchScheduledMessages.mockResolvedValueOnce({ messages: [message(1, 10)] });
    deleteScheduledMessages.mockResolvedValueOnce({ chatId: 2, messageIds: [1] });
    const { result } = mount();
    act(() => result.current.openList());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => {
      await result.current.remove(result.current.messages[0]);
    });
    expect(deleteScheduledMessages).toHaveBeenCalledWith(2, [1]);
    expect(result.current.messages).toEqual([]);

    sendScheduled.mockRejectedValueOnce(new Error('refused'));
    await act(async () => {
      await result.current.sendNow(message(5, 10));
    });
    expect(result.current.error).toBe('refused');
  });

  it('folds socket events only for the open chat', () => {
    const { result, onSent } = mount();
    act(() => result.current.apply({ type: 'scheduled_new', message: message(7, 30) }));
    expect(result.current.messages.map((item) => item.id)).toEqual([7]);
    act(() => result.current.apply({ type: 'scheduled_deleted', chatId: 3, messageIds: [7] }));
    expect(result.current.messages.map((item) => item.id)).toEqual([7]);
    const live = message(7, Date.now());
    act(() => result.current.apply({ type: 'scheduled_deleted', chatId: 2, messageIds: [7], sentMessages: [live] }));
    expect(result.current.messages).toEqual([]);
    expect(onSent).toHaveBeenCalledWith(live);
  });

  it('hands an edited queue row to the composer', () => {
    const { result, onEdit } = mount();
    const queued = message(9, 30);
    act(() => result.current.edited(queued));
    expect(onEdit).toHaveBeenCalledWith(queued);
  });

  it('does nothing for a preview chat or a closed thread', () => {
    const onError = vi.fn();
    const onSent = vi.fn();
    const onEdit = vi.fn();
    const disabled = renderHook(() => useScheduledMessages({ chatId: null, enabled: true, onError, onSent, onEdit }));
    act(() => {
      disabled.result.current.openList();
      disabled.result.current.apply({ type: 'scheduled_new', message: message(1, 10) });
      disabled.result.current.edited(message(1, 10));
    });
    expect(fetchScheduledMessages).not.toHaveBeenCalled();
    expect(disabled.result.current.messages).toEqual([]);
    expect(onEdit).not.toHaveBeenCalled();

    const preview = renderHook(() => useScheduledMessages({ chatId: 2, enabled: false, onError, onSent, onEdit }));
    act(() => {
      preview.result.current.openList();
      preview.result.current.apply({ type: 'scheduled_new', message: message(2, 10) });
    });
    expect(fetchScheduledMessages).not.toHaveBeenCalled();
    expect(preview.result.current.isOpen).toBe(false);
    expect(preview.result.current.messages).toEqual([]);
  });

  it('reports a failed read and a failed schedule', async () => {
    fetchScheduledMessages.mockRejectedValueOnce(new Error('offline'));
    const { result, onError } = mount();
    act(() => result.current.openList());
    await waitFor(() => expect(result.current.error).toBe('offline'));

    sendMessage.mockRejectedValueOnce(new Error('refused'));
    await act(async () => {
      await result.current.schedule('later', 1_900_000_100_000);
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'refused' }));
  });

  it('ignores a stale read and keeps only the latest queue', async () => {
    let resolveFirst: ((value: { messages: MessageDto[] }) => void) | undefined;
    fetchScheduledMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    fetchScheduledMessages.mockResolvedValueOnce({ messages: [message(4, 40)] });
    const { result } = mount();
    act(() => result.current.openList());
    act(() => result.current.openList());
    await waitFor(() => expect(result.current.messages.map((item) => item.id)).toEqual([4]));
    await act(async () => {
      resolveFirst?.({ messages: [message(9, 90)] });
    });
    expect(result.current.messages.map((item) => item.id)).toEqual([4]);
  });

  it('folds an edit and ignores a second write while one is in flight', async () => {
    fetchScheduledMessages.mockResolvedValueOnce({ messages: [message(1, 10)] });
    let resolveDelete: ((value: { chatId: number; messageIds: number[] }) => void) | undefined;
    deleteScheduledMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const { result } = mount();
    act(() => result.current.openList());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    act(() => result.current.apply({ type: 'scheduled_edit', message: message(1, 10, 'edited') }));
    expect(result.current.messages[0].text).toBe('edited');

    let first: Promise<void> | undefined;
    act(() => {
      first = result.current.remove(result.current.messages[0]);
      void result.current.sendNow(result.current.messages[0]);
    });
    expect(sendScheduled).not.toHaveBeenCalled();
    await act(async () => {
      resolveDelete?.({ chatId: 2, messageIds: [1] });
      await first;
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.busyIds.size).toBe(0);
  });
});
