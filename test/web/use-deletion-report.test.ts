import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDeletionReport } from '../../apps/web/src/useDeletionReport';
import type { MessageDto } from '../../apps/web/src/types';

/**
The chat list's repair from a deletion the thread witnessed.

Ids alone cannot tell the list whether the removed message was its preview or
one of its unread ones, so the thread hands the report over with the removed
and remaining messages; the hook's only job is to pass all three to the list
fold.
*/
function message(id: number): MessageDto {
  return {
    id,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    pinned: false,
    editDate: null,
    text: `message ${String(id)}`,
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

describe('useDeletionReport', () => {
  it('passes the removed ids, the removed rows and the survivors to the list fold', () => {
    const applyDeleted = vi.fn();
    const { result } = renderHook(() => useDeletionReport(applyDeleted));
    const removed = [message(3), message(4)];
    const remaining = [message(5)];

    act(() => result.current(2, removed, remaining));

    expect(applyDeleted).toHaveBeenCalledWith(2, [3, 4], removed, remaining);
  });

  it('reports an empty removal without inventing ids', () => {
    const applyDeleted = vi.fn();
    const { result } = renderHook(() => useDeletionReport(applyDeleted));

    act(() => result.current(2, [], []));

    expect(applyDeleted).toHaveBeenCalledWith(2, [], [], []);
  });
});
