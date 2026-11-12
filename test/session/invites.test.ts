import { Chat } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { joinInviteTarget, resolveInviteTarget } from '../../packages/backend-services/src/session/invites';

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

const rawInvite = {
  _: 'chatInvite',
  channel: true,
  broadcast: true,
  title: 'Announcements',
  about: 'News only',
  photo: { _: 'photoEmpty' },
  participantsCount: 12_345,
  color: 0,
} as unknown as tl.RawChatInvite;

/**
 * A client whose invite check answers with the fixed constructor, whose join
 * records the address it was asked for, and whose peer cache records every
 * stored chat.
 */
function fakeClient(options: { invite?: unknown; inviteError?: Error; join?: unknown; joinError?: Error } = {}) {
  const checked: string[] = [];
  const joined: string[] = [];
  const stored: unknown[] = [];
  const client = {
    call: async (request: { _: string; hash: string }) => {
      checked.push(request.hash);
      if (options.inviteError !== undefined) throw options.inviteError;
      return options.invite;
    },
    joinChat: async (address: string) => {
      joined.push(address);
      if (options.joinError !== undefined) throw options.joinError;
      return options.join ?? { status: 'ok', chat: new Chat(rawChannel) };
    },
    storage: {
      peers: {
        store: async (chat: unknown) => {
          stored.push(chat);
        },
      },
    },
  } as unknown as TelegramClient;
  return { client, checked, joined, stored };
}

/**
An RPC-shaped failure, which the engine recognises by its `text` field.
*/
function rpcFailure(text: string): Error {
  const error = new Error(text);
  (error as Error & { text: string }).text = text;
  return error;
}

describe('resolveInviteTarget', () => {
  it('opens the chat of an invite the account is already in, and caches its peer', async () => {
    const { client, checked, stored } = fakeClient({
      invite: { _: 'chatInviteAlready', chat: rawChannel } satisfies tl.RawChatInviteAlready,
    });

    await expect(resolveInviteTarget(client, { invite: 'AbCd-123' })).resolves.toEqual({
      status: 'joined',
      chat: expect.objectContaining({ id: -1_000_000_000_020, kind: 'channel', title: 'Announcements' }),
    });
    expect(checked).toEqual(['AbCd-123']);
    expect(stored).toEqual([rawChannel]);
  });

  it('treats a peek invite as the readable chat Telegram returned', async () => {
    const { client } = fakeClient({
      invite: { _: 'chatInvitePeek', chat: rawChannel, expires: 1_800_000_000 } satisfies tl.RawChatInvitePeek,
    });

    await expect(resolveInviteTarget(client, { invite: 'AbCd-123' })).resolves.toMatchObject({
      status: 'joined',
      chat: { title: 'Announcements' },
    });
  });

  it('describes a chat the account is not in without naming a peer', async () => {
    const { client } = fakeClient({ invite: rawInvite });

    await expect(resolveInviteTarget(client, { invite: 'AbCd-123' })).resolves.toEqual({
      status: 'preview',
      preview: { title: 'Announcements', kind: 'channel', memberCount: 12_345, withApproval: false, about: 'News only' },
    });
  });

  it('reads a supergroup and a basic group, and the approval flag', async () => {
    const supergroup = { ...rawInvite, broadcast: false, megagroup: true, requestNeeded: true } as unknown as tl.RawChatInvite;
    const group = { ...rawInvite, channel: false, broadcast: false, megagroup: false, about: undefined } as unknown as tl.RawChatInvite;

    await expect(resolveInviteTarget(fakeClient({ invite: supergroup }).client, { invite: 'a' })).resolves.toMatchObject({
      preview: { kind: 'supergroup', withApproval: true },
    });
    await expect(resolveInviteTarget(fakeClient({ invite: group }).client, { invite: 'a' })).resolves.toMatchObject({
      preview: { kind: 'group', about: null },
    });
  });

  it('accepts the hash alone and the three link forms', async () => {
    for (const invite of ['AbCd-123', 'https://t.me/+AbCd-123', 'https://t.me/joinchat/AbCd-123', 'https://telegram.me/+AbCd-123/']) {
      const { client, checked } = fakeClient({ invite: rawInvite });
      await resolveInviteTarget(client, { invite });
      expect(checked).toEqual(['AbCd-123']);
    }
  });

  it('rejects an invite that is not a hash before Telegram is touched', async () => {
    for (const invite of ['', 'not a hash', 'https://t.me/addstickers/cats', 'https://t.me/+', 'x'.repeat(300)]) {
      const { client, checked } = fakeClient({ invite: rawInvite });
      await expect(resolveInviteTarget(client, { invite })).rejects.toMatchObject({ status: 400, code: 'validation' });
      expect(checked).toEqual([]);
    }
    await expect(resolveInviteTarget(fakeClient().client, {})).rejects.toMatchObject({ status: 400 });
  });

  it('names a dead link so the card can say why it cannot be joined', async () => {
    const expired = fakeClient({ inviteError: rpcFailure('INVITE_HASH_EXPIRED') });
    await expect(resolveInviteTarget(expired.client, { invite: 'a' })).rejects.toMatchObject({
      status: 410,
      code: 'invite_expired',
    });
    const invalid = fakeClient({ inviteError: rpcFailure('INVITE_HASH_INVALID') });
    await expect(resolveInviteTarget(invalid.client, { invite: 'a' })).rejects.toMatchObject({
      status: 404,
      code: 'invite_invalid',
    });
  });

  it('keeps a failure that is not the link itself', async () => {
    const { client } = fakeClient({ inviteError: rpcFailure('FLOOD_WAIT_5') });

    await expect(resolveInviteTarget(client, { invite: 'a' })).rejects.toThrow('FLOOD_WAIT_5');
  });
});

describe('joinInviteTarget', () => {
  it('joins through the canonical invite link Telegram accepts', async () => {
    const { client, joined } = fakeClient();

    await expect(joinInviteTarget(client, { invite: 'AbCd-123' })).resolves.toMatchObject({
      status: 'joined',
      chat: { username: 'announce' },
    });
    expect(joined).toEqual(['https://t.me/+AbCd-123']);
  });

  it('reports a join request that an admin has to approve', async () => {
    const { client } = fakeClient({ join: { status: 'request_sent' } });

    await expect(joinInviteTarget(client, { invite: 'a' })).resolves.toEqual({ status: 'request_sent', chat: null });
  });

  it('reports a guard bot that wants its web view opened', async () => {
    const { client } = fakeClient({ join: { status: 'webview', bot: {}, queryId: 1 } });

    await expect(joinInviteTarget(client, { invite: 'a' })).resolves.toEqual({ status: 'webview', chat: null });
  });

  it('answers already-participant as the joined chat', async () => {
    const { client } = fakeClient({
      invite: { _: 'chatInviteAlready', chat: rawChannel } satisfies tl.RawChatInviteAlready,
      joinError: rpcFailure('USER_ALREADY_PARTICIPANT'),
    });

    await expect(joinInviteTarget(client, { invite: 'a' })).resolves.toMatchObject({
      status: 'joined',
      chat: { title: 'Announcements' },
    });
  });

  it('maps a dead link onto the same two codes as the resolve', async () => {
    await expect(
      joinInviteTarget(fakeClient({ joinError: rpcFailure('INVITE_HASH_EXPIRED') }).client, { invite: 'a' }),
    ).rejects.toMatchObject({
      code: 'invite_expired',
    });
    await expect(
      joinInviteTarget(fakeClient({ joinError: rpcFailure('INVITE_HASH_INVALID') }).client, { invite: 'a' }),
    ).rejects.toMatchObject({
      code: 'invite_invalid',
    });
  });

  it('keeps a failure that is not the link itself', async () => {
    const { client } = fakeClient({ joinError: rpcFailure('CHANNEL_PRIVATE') });

    await expect(joinInviteTarget(client, { invite: 'a' })).rejects.toThrow('CHANNEL_PRIVATE');
  });
});
