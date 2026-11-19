import { User } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { searchContacts } from '../../packages/backend-services/src/session/contacts';

/**
 * The new-message picker's read: the address book on a blank query, and
 * Telegram's own contacts search otherwise.
 *
 * The sort is the picker's, not Telegram's: two reads of one address book must
 * list the same people in the same order. The filters matter for the same
 * reason a menu item matters — a deleted account and an incomplete chat cannot
 * be opened, so they must not be offered.
 */

function rawUser(overrides: Partial<tl.RawUser> & Pick<tl.RawUser, 'id' | 'firstName'>): tl.RawUser {
  return {
    _: 'user',
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
    lastName: undefined,
    username: undefined,
    status: undefined,
    ...overrides,
  } as unknown as tl.RawUser;
}

function rawChannel(overrides: Partial<tl.RawChannel> & Pick<tl.RawChannel, 'id' | 'title'>): tl.RawChannel {
  return {
    _: 'channel',
    broadcast: false,
    megagroup: true,
    date: 1_700_000_000,
    accessHash: 20_000,
    min: false,
    ...overrides,
  } as unknown as tl.RawChannel;
}

interface FakeClientOptions {
  contacts?: tl.RawUser[];
  search?: { users?: tl.RawUser[]; chats?: tl.RawChannel[] };
  calls?: unknown[];
}

/**
 * A client whose address book and search answer are fixed, recording the
 * search request so the clamp and the trimmed query can be asserted.
 */
function fakeClient(options: FakeClientOptions = {}): { client: TelegramClient; calls: unknown[] } {
  const calls: unknown[] = options.calls ?? [];
  const users = options.contacts ?? [];
  const client = {
    getContacts: async () => users.map((raw) => new User(raw)),
    call: async (request: unknown) => {
      calls.push(request);
      return {
        _: 'contacts.found',
        myResults: [],
        results: [],
        users: options.search?.users ?? [],
        chats: options.search?.chats ?? [],
      };
    },
  } as unknown as TelegramClient;
  return { client, calls };
}

function titles(chats: readonly { title: string }[]): string[] {
  return chats.map((chat) => chat.title);
}

describe('searchContacts', () => {
  it('reads the address book on a blank query, alphabetically and without deleted or self rows', async () => {
    const { client, calls } = fakeClient({
      contacts: [
        rawUser({ id: 3, firstName: 'zoe' }),
        rawUser({ id: 1, firstName: 'Ada' }),
        rawUser({ id: 2, firstName: 'Bob', deleted: true }),
        rawUser({ id: 4, firstName: 'Me', self: true }),
      ],
    });

    const result = await searchContacts(client, {});

    expect(titles(result.people)).toEqual(['Ada', 'zoe']);
    expect(result.chats).toEqual([]);
    // The address book is one read; no search is sent for it.
    expect(calls).toEqual([]);
  });

  it('treats a blank or whitespace query as the address book, not as a search', async () => {
    const { client, calls } = fakeClient({ contacts: [rawUser({ id: 1, firstName: 'Ada' })] });

    const blank = await searchContacts(client, { query: ' '.repeat(3) });

    expect(titles(blank.people)).toEqual(['Ada']);
    expect(calls).toEqual([]);
  });

  it('searches Telegram for a query, splitting people from public chats', async () => {
    const { client, calls } = fakeClient({
      search: {
        users: [rawUser({ id: 1, firstName: 'Ada', username: 'ada' })],
        chats: [rawChannel({ id: 20, title: 'Announcements', username: 'announce', broadcast: true, megagroup: false })],
      },
    });

    const result = await searchContacts(client, { query: '  ada  ' });

    expect(titles(result.people)).toEqual(['Ada']);
    expect(titles(result.chats)).toEqual(['Announcements']);
    expect(calls).toEqual([{ _: 'contacts.search', q: 'ada', limit: 20 }]);
    expect(result.people[0].username).toBe('ada');
    expect(result.chats[0].kind).toBe('channel');
  });

  it('drops a deleted account and an incomplete chat from the search answer', async () => {
    const { client } = fakeClient({
      search: {
        users: [rawUser({ id: 1, firstName: 'Ada', deleted: true }), rawUser({ id: 2, firstName: 'Bob' })],
        chats: [rawChannel({ id: 20, title: 'Hidden', min: true }), rawChannel({ id: 21, title: 'Open' })],
      },
    });

    const result = await searchContacts(client, { query: 'x' });

    expect(titles(result.people)).toEqual(['Bob']);
    expect(titles(result.chats)).toEqual(['Open']);
  });

  it('clamps the page the picker asks for', async () => {
    const high = fakeClient();
    await searchContacts(high.client, { query: 'x', limit: 500 });
    expect(high.calls).toEqual([{ _: 'contacts.search', q: 'x', limit: 50 }]);

    const low = fakeClient();
    await searchContacts(low.client, { query: 'x', limit: 0 });
    expect(low.calls).toEqual([{ _: 'contacts.search', q: 'x', limit: 1 }]);
  });

  it('rejects a query that is not a string, or is too long', async () => {
    const { client } = fakeClient();

    await expect(searchContacts(client, { query: 42 })).rejects.toMatchObject({ status: 400 });
    await expect(searchContacts(client, { query: 'x'.repeat(257) })).rejects.toMatchObject({ status: 400 });
  });
});
