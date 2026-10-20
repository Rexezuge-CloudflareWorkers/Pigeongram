import { Long, Message, PeersIndex } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { serviceText } from '../../worker/src/session/service-text';

const rawUser = {
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
  lastName: 'Lovelace',
  username: 'ada',
} as unknown as tl.RawUser;

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

function index(): PeersIndex {
  return PeersIndex.from({ users: [rawUser], chats: [rawChannel] });
}

function serviceMessage(action: Record<string, unknown>, overrides: Record<string, unknown> = {}): Message {
  const raw = {
    _: 'messageService',
    id: 8,
    peerId: { _: 'peerUser', userId: 1 },
    fromId: { _: 'peerUser', userId: 1 },
    date: 1_700_000_100,
    out: false,
    action,
    ...overrides,
  } as unknown as tl.RawMessageService;
  return new Message(raw, index());
}

function ttlMessage(period: number, overrides: Record<string, unknown> = {}): Message {
  return serviceMessage({ _: 'messageActionSetMessagesTTL', period }, overrides);
}

describe('serviceText', () => {
  it('words an outgoing auto-delete change as the account’s own', () => {
    expect(serviceText(ttlMessage(2_678_400, { out: true }), 'Ada Lovelace')).toBe('You set messages to auto-delete in 1 month');
  });

  it('names the sender of an incoming change', () => {
    expect(serviceText(ttlMessage(604_800), 'Ada Lovelace')).toBe('Ada Lovelace set messages to auto-delete in 1 week');
  });

  it('falls back to Someone when the sender hides their name', () => {
    expect(serviceText(ttlMessage(86_400), null)).toBe('Someone set messages to auto-delete in 1 day');
  });

  it('renders a disabled timer', () => {
    expect(serviceText(ttlMessage(0, { out: true }), 'Ada Lovelace')).toBe('You disabled the auto-delete timer');
    expect(serviceText(ttlMessage(0), 'Ada Lovelace')).toBe('Ada Lovelace disabled the auto-delete timer');
  });

  it('uses the channel wording', () => {
    const channel = { peerId: { _: 'peerChannel', channelId: 20 }, fromId: null };
    expect(serviceText(ttlMessage(2_678_400, channel), null)).toBe('Messages in this channel will be automatically deleted after 1 month');
    expect(serviceText(ttlMessage(0, channel), null)).toBe('Messages in this channel will no longer be automatically deleted');
  });

  it('formats TTL units the way Telegram does', () => {
    const cases: [number, string][] = [
      [1, '1 second'],
      [60, '1 minute'],
      [3600, '1 hour'],
      [86_400, '1 day'],
      [86_400 * 3, '3 days'],
      [604_800, '1 week'],
      [1_209_600, '2 weeks'],
      [86_400 * 10, '1 week 3 days'],
      [2_678_400, '1 month'],
      [2_678_400 * 11, '11 months'],
      [31_536_000, '1 year'],
      [31_536_000 * 2, '2 years'],
    ];
    for (const [period, label] of cases) {
      expect(serviceText(ttlMessage(period, { out: true }), null)).toBe(`You set messages to auto-delete in ${label}`);
    }
  });

  it('leaves other service actions and regular messages without service text', () => {
    expect(serviceText(serviceMessage({ _: 'messageActionPinMessage' }), 'Ada Lovelace')).toBe('');
    const plain = new Message(
      {
        _: 'message',
        id: 9,
        peerId: { _: 'peerUser', userId: 1 },
        fromId: { _: 'peerUser', userId: 1 },
        date: 1_700_000_100,
        message: 'hello',
        out: false,
      } as unknown as tl.RawMessage,
      index(),
    );
    expect(serviceText(plain, 'Ada Lovelace')).toBe('');
  });
});
