import { describe, expect, it } from 'vitest';
import { applyScheduledEvent, mergeScheduledMessages } from '../../apps/web/src/scheduled-state';
import type { MessageDto } from '../../apps/web/src/types';

function message(id: number, date: number, text = `m${id}`): MessageDto {
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

describe('scheduled queue folds', () => {
  it('merges by id in send-time order', () => {
    expect(mergeScheduledMessages([message(2, 20), message(1, 10)], [message(2, 30), message(3, 5)]).map((item) => item.id)).toEqual([
      3, 1, 2,
    ]);
    expect(mergeScheduledMessages([message(1, 10)], [message(1, 10)]).map((item) => item.id)).toEqual([1]);
  });

  it('folds an arrival, an edit and a removal without touching other events', () => {
    const current = [message(1, 10), message(2, 20)];
    expect(applyScheduledEvent(current, { type: 'scheduled_new', message: message(3, 30) })?.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(applyScheduledEvent(current, { type: 'scheduled_edit', message: message(1, 10, 'changed') })?.[0].text).toBe('changed');
    expect(applyScheduledEvent(current, { type: 'scheduled_deleted', chatId: 2, messageIds: [1] })?.map((item) => item.id)).toEqual([2]);
    expect(applyScheduledEvent(current, { type: 'new_message', message: message(9, 40) })).toBeNull();
  });
});
