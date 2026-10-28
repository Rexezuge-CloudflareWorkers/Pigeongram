import { Chat, MtPeerNotFoundError, User } from '@mtcute/core';
import type { Peer, tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { joinChatTarget, resolveChatTarget } from '../../packages/backend-services/src/session/resolve-chat';

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
  accessHash: 20_000,
} as unknown as tl.RawChannel;

const rawLeftChannel = {
  ...rawChannel,
  left: true,
} as unknown as tl.RawChannel;

/**
A client whose peer lookup answers with the fixed peer and whose join records
the address it was asked for.
*/
function fakeClient(peer: Peer, joinResult?: unknown) {
  const joined = joinResult ?? { status: 'ok', chat: peer };
  const addresses: unknown[] = [];
  const client = {
    getPeer: async (address: unknown) => {
      addresses.push(address);
      return peer;
    },
    joinChat: async (address: unknown) => {
      addresses.push(address);
      return joined;
    },
  } as unknown as TelegramClient;
  return { client, addresses };
}

describe('resolveChatTarget', () => {
  it('resolves a username case-insensitively and without its @', async () => {
    const { client, addresses } = fakeClient(new Chat(rawChannel));

    await expect(resolveChatTarget(client, { username: '@Announce' })).resolves.toMatchObject({
      member: true,
      chat: { id: -1_000_000_000_020, kind: 'channel', title: 'Announcements', username: 'announce' },
    });
    expect(addresses).toEqual(['announce']);
  });

  it('resolves a marked chat id as the bridge addresses it', async () => {
    const { client, addresses } = fakeClient(new User(rawUser));

    await expect(resolveChatTarget(client, { chatId: 1 })).resolves.toMatchObject({
      member: true,
      chat: { id: 1, kind: 'user', title: 'Ada Lovelace' },
    });
    expect(addresses).toEqual([1]);
  });

  it('reports a public channel the account has not joined as a preview', async () => {
    const { client } = fakeClient(new Chat(rawLeftChannel));

    await expect(resolveChatTarget(client, { username: 'announce' })).resolves.toMatchObject({
      member: false,
      chat: { username: 'announce', canSendMessages: false },
    });
  });

  it('answers a peer Telegram does not know as not found', async () => {
    const client = {
      getPeer: async () => {
        throw new MtPeerNotFoundError('Peer not found');
      },
    } as unknown as TelegramClient;

    await expect(resolveChatTarget(client, { username: 'nobody' })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('keeps a not-found RPC text as a 404 too', async () => {
    const client = {
      getPeer: async () => {
        const error = new Error('USERNAME_NOT_OCCUPIED');
        (error as Error & { text: string }).text = 'USERNAME_NOT_OCCUPIED';
        throw error;
      },
    } as unknown as TelegramClient;

    await expect(resolveChatTarget(client, { username: 'nobody' })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('keeps a failure that is not a missing peer', async () => {
    const client = {
      getPeer: async () => {
        throw new Error('FLOOD_WAIT_5');
      },
    } as unknown as TelegramClient;

    await expect(resolveChatTarget(client, { username: 'announce' })).rejects.toThrow('FLOOD_WAIT_5');
  });

  it('requires exactly one valid target', async () => {
    const { client, addresses } = fakeClient(new Chat(rawChannel));

    await expect(resolveChatTarget(client, {})).rejects.toMatchObject({ status: 400, code: 'validation' });
    await expect(resolveChatTarget(client, { username: 'announce', chatId: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(resolveChatTarget(client, { username: 'a' })).rejects.toMatchObject({ status: 400 });
    await expect(resolveChatTarget(client, { chatId: 0 })).rejects.toMatchObject({ status: 400 });
    expect(addresses).toEqual([]);
  });
});

describe('joinChatTarget', () => {
  it('answers an already-joined chat without touching the join API', async () => {
    const { client, addresses } = fakeClient(new Chat(rawChannel));

    await expect(joinChatTarget(client, { username: 'announce' })).resolves.toMatchObject({
      status: 'joined',
      chat: { username: 'announce' },
    });
    // Only the resolve looked the peer up; the join was skipped.
    expect(addresses).toEqual(['announce']);
  });

  it('joins through the resolved username, not the request', async () => {
    const { client, addresses } = fakeClient(new Chat(rawLeftChannel));

    await expect(joinChatTarget(client, { chatId: -1_000_000_000_020 })).resolves.toMatchObject({
      status: 'joined',
      chat: { username: 'announce' },
    });
    expect(addresses).toEqual([-1_000_000_000_020, 'announce']);
  });

  it('falls back to the requested username when the peer has none', async () => {
    const peer = new Chat({ ...rawLeftChannel, username: undefined } as unknown as tl.RawChannel);
    const { client, addresses } = fakeClient(peer);

    await joinChatTarget(client, { username: 'announce' });
    expect(addresses).toEqual(['announce', 'announce']);
  });

  it('reports a join request that an admin has to approve', async () => {
    const { client } = fakeClient(new Chat(rawLeftChannel), { status: 'request_sent' });

    await expect(joinChatTarget(client, { username: 'announce' })).resolves.toEqual({ status: 'request_sent', chat: null });
  });

  it('reports a guard bot that wants its web view opened', async () => {
    const { client } = fakeClient(new Chat(rawLeftChannel), { status: 'webview', bot: new User(rawUser), queryId: 1 });

    await expect(joinChatTarget(client, { username: 'announce' })).resolves.toEqual({ status: 'webview', chat: null });
  });

  it('answers a join Telegram does not know as not found', async () => {
    const client = {
      getPeer: async () => new Chat(rawLeftChannel),
      joinChat: async () => {
        throw new MtPeerNotFoundError('Peer not found');
      },
    } as unknown as TelegramClient;

    await expect(joinChatTarget(client, { username: 'announce' })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});
