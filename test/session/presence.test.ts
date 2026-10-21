import { Chat, User } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { presenceOf, presenceOfPeer, readContactPresences } from '../../worker/src/session/presence';

const rawUser = {
  _: 'user',
  id: 1,
  self: false,
  contact: true,
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
} as unknown as tl.RawUser;

const rawBot = { ...rawUser, id: 5, bot: true, firstName: 'Helper' } as unknown as tl.RawUser;

const rawChat = {
  _: 'chat',
  id: 10,
  title: 'Old Group',
  photo: null,
  participants: [],
  version: 1,
} as unknown as tl.RawChat;

describe('presenceOf', () => {
  it('reads the online state', () => {
    expect(presenceOf({ _: 'userStatusOnline', expires: 1_700_000_600 } as unknown as tl.TypeUserStatus)).toEqual({
      status: 'online',
      lastSeenAt: null,
    });
  });

  it('turns the offline timestamp into milliseconds', () => {
    expect(presenceOf({ _: 'userStatusOffline', wasOnline: 1_700_000_000 } as unknown as tl.TypeUserStatus)).toEqual({
      status: 'offline',
      lastSeenAt: 1_700_000_000_000,
    });
  });

  it('reads the coarse states', () => {
    const cases: Array<[tl.TypeUserStatus, string]> = [
      [{ _: 'userStatusRecently' } as unknown as tl.TypeUserStatus, 'recently'],
      [{ _: 'userStatusLastWeek' } as unknown as tl.TypeUserStatus, 'within_week'],
      [{ _: 'userStatusLastMonth' } as unknown as tl.TypeUserStatus, 'within_month'],
    ];
    for (const [status, expected] of cases) {
      expect(presenceOf(status)).toEqual({ status: expected, lastSeenAt: null });
    }
  });

  it('reads Telegram’s "no state" as no presence, not as "long ago"', () => {
    expect(presenceOf({ _: 'userStatusEmpty' } as unknown as tl.TypeUserStatus)).toBeNull();
    expect(presenceOf(undefined)).toBeNull();
  });
});

describe('presenceOfPeer', () => {
  it('reads the state Telegram attached to the user', () => {
    const online = { ...rawUser, status: { _: 'userStatusOnline', expires: 0 } } as unknown as tl.RawUser;
    expect(presenceOfPeer(new User(online))).toEqual({ status: 'online', lastSeenAt: null });
  });

  it('has no presence for a bot or a chat', () => {
    expect(presenceOfPeer(new User(rawBot))).toBeNull();
    expect(presenceOfPeer(new Chat(rawChat))).toBeNull();
  });

  it('has no presence for the account’s own row', () => {
    const self = { ...rawUser, self: true } as unknown as tl.RawUser;
    expect(presenceOfPeer(new User(self))).toBeNull();
  });
});

describe('readContactPresences', () => {
  it('keys the contacts’ presences by user id', async () => {
    const calls: unknown[] = [];
    const client = {
      call: async (request: unknown) => {
        calls.push(request);
        return [
          { _: 'contactStatus', userId: 1, status: { _: 'userStatusOnline', expires: 0 } },
          { _: 'contactStatus', userId: 2, status: { _: 'userStatusOffline', wasOnline: 1_700_000_000 } },
        ];
      },
    } as unknown as TelegramClient;

    const presences = await readContactPresences(client);

    expect(calls).toEqual([{ _: 'contacts.getStatuses' }]);
    expect(presences.get(1)).toEqual({ status: 'online', lastSeenAt: null });
    expect(presences.get(2)).toEqual({ status: 'offline', lastSeenAt: 1_700_000_000_000 });
  });

  it('leaves a contact without a state out, so the peer’s own state stays', async () => {
    const client = {
      call: async () => [{ _: 'contactStatus', userId: 1, status: { _: 'userStatusEmpty' } }],
    } as unknown as TelegramClient;

    expect((await readContactPresences(client)).size).toBe(0);
  });

  it('degrades to no presences when the method is unavailable', async () => {
    const client = {
      call: async () => {
        throw new Error('METHOD_NOT_AVAILABLE');
      },
    } as unknown as TelegramClient;

    expect((await readContactPresences(client)).size).toBe(0);
  });
});
