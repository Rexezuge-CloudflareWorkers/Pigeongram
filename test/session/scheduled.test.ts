import { Long, Message, PeersIndex, RawUpdateInfo } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it, vi } from 'vitest';
import { optionalScheduleDate } from '../../packages/backend-services/src/session/params';
import { echoEvent, mapRawUpdate } from '../../packages/backend-services/src/session/updates';
import { rpc } from './rpc-dispatch';

const peers = PeersIndex.from({
  users: [
    {
      _: 'user',
      id: 1,
      self: false,
      contact: false,
      mutualContact: false,
      deleted: false,
      bot: false,
      botChatHistory: false,
      botNochats: false,
      verified: false,
      restricted: false,
      min: false,
      firstName: 'Ada',
    } as unknown as tl.RawUser,
  ],
  chats: [],
});

function message(id: number, date = 1_900_000_000_000): Message {
  return new Message(
    {
      _: 'message',
      id,
      peerId: { _: 'peerUser', userId: 1 },
      date: Math.floor(date / 1000),
      message: `queued ${id}`,
      out: true,
    } as unknown as tl.RawMessage,
    peers,
  );
}

function info(update: Record<string, unknown>): RawUpdateInfo {
  return new RawUpdateInfo(update as unknown as tl.TypeUpdate, peers);
}

function clientWith(overrides: Record<string, unknown>): TelegramClient {
  return overrides as unknown as TelegramClient;
}

describe('scheduled message validation', () => {
  const now = 1_900_000_000_000;

  it('accepts an omitted or future time', () => {
    expect(optionalScheduleDate(undefined, now)).toBeUndefined();
    expect(optionalScheduleDate(now + 60_000, now)).toBe(now + 60_000);
  });

  it('refuses a past time, a far horizon and a non-integer', () => {
    expect(() => optionalScheduleDate(now, now)).toThrow('in the future');
    expect(() => optionalScheduleDate(now + 366 * 24 * 60 * 60 * 1000, now)).toThrow('too far');
    expect(() => optionalScheduleDate(1.5, now)).toThrow('unix milliseconds');
  });
});

describe('scheduled RPC methods', () => {
  it('reads the queue through getAllScheduledMessages', async () => {
    const getAllScheduledMessages = vi.fn(async () => [message(11), message(12)]);
    const result = (await rpc(clientWith({ getAllScheduledMessages }), 'getScheduledMessages', { chatId: 1 })) as {
      messages: Array<{ id: number; text: string }>;
    };
    expect(getAllScheduledMessages).toHaveBeenCalledWith(1);
    expect(result.messages).toMatchObject([
      { id: 11, text: 'queued 11' },
      { id: 12, text: 'queued 12' },
    ]);
  });

  it('deletes only the named ids', async () => {
    const deleteScheduledMessages = vi.fn(async () => {});
    const result = (await rpc(clientWith({ deleteScheduledMessages }), 'deleteScheduledMessages', {
      chatId: 1,
      messageIds: [11, 12],
    })) as { chatId: number; messageIds: number[] };
    expect(deleteScheduledMessages).toHaveBeenCalledWith(1, [11, 12]);
    expect(result).toEqual({ chatId: 1, messageIds: [11, 12] });
  });

  it('sends named messages now and returns the live copies', async () => {
    const sendScheduled = vi.fn(async () => [message(11, Date.now() + 3_600_000)]);
    const result = (await rpc(clientWith({ sendScheduled }), 'sendScheduled', { chatId: 1, messageIds: [11] })) as {
      messages: Array<{ id: number }>;
    };
    expect(sendScheduled).toHaveBeenCalledWith(1, [11]);
    expect(result.messages.map((item) => item.id)).toEqual([11]);
  });

  it('passes a future time to a text send and marks the answer scheduled', async () => {
    const at = Date.now() + 3_600_000;
    const sendText = vi.fn(async () => message(21, at));
    const result = (await rpc(clientWith({ sendText }), 'sendMessage', {
      chatId: 1,
      text: 'later',
      randomId: '1234',
      scheduleDate: at,
    })) as { scheduled?: boolean; message: { id: number } };
    expect(sendText).toHaveBeenCalledWith(1, 'later', { randomId: Long.fromNumber(1234), schedule: new Date(at) });
    expect(result).toMatchObject({ scheduled: true, message: { id: 21 } });
  });

  it('refuses a send time that has already passed before calling Telegram', async () => {
    const sendText = vi.fn(async () => message(21));
    await expect(rpc(clientWith({ sendText }), 'sendMessage', { chatId: 1, text: 'late', scheduleDate: 1 })).rejects.toThrow(
      'in the future',
    );
    expect(sendText).not.toHaveBeenCalled();
  });

  it('passes a future time to an edit of a queued message', async () => {
    const at = Date.now() + 3_600_000;
    const editMessage = vi.fn(async () => message(21, at));
    const result = (await rpc(clientWith({ editMessage }), 'editMessage', {
      chatId: 1,
      messageId: 21,
      text: 'new',
      scheduleDate: at,
    })) as { scheduled?: boolean };
    expect(editMessage).toHaveBeenCalledWith({ chatId: 1, message: 21, text: 'new', scheduleDate: new Date(at) });
    expect(result.scheduled).toBe(true);
  });
});

describe('scheduled update mapping and echoes', () => {
  it('maps a new queued message and a queue removal', () => {
    expect(
      mapRawUpdate(
        info({
          _: 'updateNewScheduledMessage',
          message: {
            _: 'message',
            id: 31,
            peerId: { _: 'peerUser', userId: 1 },
            date: 1_900_000_000,
            message: 'queued',
            out: true,
          },
        }),
      ),
    ).toMatchObject({ type: 'scheduled_new', message: { id: 31 } });
    expect(
      mapRawUpdate(info({ _: 'updateDeleteScheduledMessages', peer: { _: 'peerUser', userId: 1 }, messages: [31], sentMessages: [31] })),
    ).toEqual({ type: 'scheduled_deleted', chatId: 1, messageIds: [31] });
  });

  it('echoes the writes whose own updates mtcute can swallow', () => {
    const queued = { id: 41, chatId: 1 } as never;
    expect(echoEvent('sendMessage', { message: queued, scheduled: true })).toEqual({ type: 'scheduled_new', message: queued });
    expect(echoEvent('editMessage', { message: queued, scheduled: true })).toEqual({ type: 'scheduled_edit', message: queued });
    expect(echoEvent('editMessage', { message: queued })).toEqual({ type: 'edit_message', message: queued });
    expect(echoEvent('sendMessage', { message: queued })).toBeNull();
    expect(echoEvent('deleteScheduledMessages', { chatId: 1, messageIds: [41] })).toEqual({
      type: 'scheduled_deleted',
      chatId: 1,
      messageIds: [41],
    });
    expect(echoEvent('sendScheduled', { chatId: 1, messageIds: [41], messages: [queued] })).toEqual({
      type: 'scheduled_deleted',
      chatId: 1,
      messageIds: [41],
      sentMessages: [queued],
    });
  });
});
