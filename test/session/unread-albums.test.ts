import { Long, Message, PeersIndex } from '@mtcute/core';
import type { Dialog } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { tl } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { CallRegistry } from '../../packages/backend-services/src/session/call-registry';
import { dispatchRpc } from '../../packages/backend-services/src/session/rpc';
import { albumAwareUnread, reconcileUnreadAlbums, UnreadAlbumLedger } from '../../packages/backend-services/src/session/unread-albums';
import type { MessageDto, UpdateEvent } from '../../packages/shared/src/types';
import { createNodeSqlStorage, openNodeDatabase } from './node-sql';

/**
 * The album ledger: Telegram counts every album member as a message, while
 * the badge counts the album once. The ledger knows the surplus, and the
 * bridge subtracts it from the counts it serves.
 */

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

const peers = PeersIndex.from({ users: [rawUser], chats: [] });

function ledger(): UnreadAlbumLedger {
  return new UnreadAlbumLedger(createNodeSqlStorage(openNodeDatabase()));
}

function message(id: number, groupedId?: number): Message {
  return new Message(
    {
      _: 'message',
      id,
      peerId: { _: 'peerUser', userId: 1 },
      fromId: { _: 'peerUser', userId: 1 },
      date: 1_700_000_000,
      message: `m${id}`,
      out: false,
      ...(groupedId !== undefined && { groupedId: Long.fromNumber(groupedId) }),
    } as unknown as tl.RawMessage,
    peers,
  );
}

function messageDto(overrides: Partial<MessageDto> & { id: number }): MessageDto {
  return {
    chatId: 1,
    groupedId: null,
    senderId: 1,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text: '',
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
    ...overrides,
  };
}

function dialog(overrides: Partial<Dialog> = {}): Dialog {
  return {
    peer: { id: 1 },
    unreadCount: 3,
    lastReadIngoing: 9,
    lastMessage: message(12),
    ...overrides,
  } as unknown as Dialog;
}

/**
 * A fake client whose chat list holds one dialog with three unread messages
 * and whose history answers with the album those three messages form.
 */
function fakeClient(
  messages: readonly Message[] = [],
  overrides: Partial<Dialog> = {},
): { client: TelegramClient; reads: Array<{ chatId: number; params: unknown }> } {
  const reads: Array<{ chatId: number; params: unknown }> = [];
  const client = {
    iterDialogs: async function* () {
      yield dialog(overrides);
    },
    getHistory: async (chatId: number, params?: unknown) => {
      reads.push({ chatId, params });
      return messages;
    },
    call: async () => [],
  } as unknown as TelegramClient;
  return { client, reads };
}

describe('UnreadAlbumLedger', () => {
  it('reports the members of an album beyond the first as the surplus', () => {
    const albums = ledger();

    albums.recordIncoming(1, 10, '77');
    albums.recordIncoming(1, 11, '77');
    albums.recordIncoming(1, 12, '77');

    expect(albums.excessFor(1)).toBe(2);
    expect(albums.excessByChat().get(1)).toBe(2);
  });

  it('keeps the chats apart, and a single-member album has no surplus', () => {
    const albums = ledger();

    albums.recordIncoming(1, 10, '77');
    albums.recordIncoming(1, 11, '77');
    albums.recordIncoming(2, 20, '88');

    expect(albums.excessFor(1)).toBe(1);
    expect(albums.excessFor(2)).toBe(0);
  });

  it('drops the members a read covered', () => {
    const albums = ledger();

    albums.recordIncoming(1, 10, '77');
    albums.recordIncoming(1, 11, '77');
    albums.pruneRead(1, 10);

    // One member of the album is left, so the album still counts once.
    expect(albums.excessFor(1)).toBe(0);
  });

  it('empties itself when the account it described is gone', () => {
    const albums = ledger();

    albums.recordIncoming(1, 10, '77');
    albums.markReconciled();
    albums.clear();

    expect(albums.excessFor(1)).toBe(0);
    expect(albums.isReconciled()).toBe(false);
  });
});

describe('the ledger and the update stream', () => {
  it('records an incoming album member', () => {
    const albums = ledger();

    albums.apply({ type: 'new_message', message: messageDto({ id: 10, groupedId: '77' }) });
    albums.apply({ type: 'new_message', message: messageDto({ id: 11, groupedId: '77' }) });

    expect(albums.excessFor(1)).toBe(1);
  });

  it('ignores the account’s own messages and the service ones', () => {
    const albums = ledger();

    albums.apply({ type: 'new_message', message: messageDto({ id: 10, groupedId: '77', outgoing: true }) });
    albums.apply({ type: 'new_message', message: messageDto({ id: 11, groupedId: '77', service: true }) });

    expect(albums.excessFor(1)).toBe(0);
  });

  it('corrects the count a read reports: an album that is still unread counts once', () => {
    const albums = ledger();

    albums.apply({ type: 'new_message', message: messageDto({ id: 10, groupedId: '77' }) });
    albums.apply({ type: 'new_message', message: messageDto({ id: 11, groupedId: '77' }) });
    albums.apply({ type: 'new_message', message: messageDto({ id: 12, groupedId: '77' }) });

    const event = albums.apply({ type: 'read', chatId: 1, maxId: 9, unread: 3, inbox: true });

    expect(event).toEqual({ type: 'read', chatId: 1, maxId: 9, unread: 1, inbox: true });
  });

  it('leaves the outbox reads alone', () => {
    const albums = ledger();

    albums.apply({ type: 'new_message', message: messageDto({ id: 10, groupedId: '77' }) });
    albums.apply({ type: 'new_message', message: messageDto({ id: 11, groupedId: '77' }) });

    const event: UpdateEvent = albums.apply({ type: 'read', chatId: 1, maxId: 9, unread: 0, inbox: false });

    expect(event).toEqual({ type: 'read', chatId: 1, maxId: 9, unread: 0, inbox: false });
    expect(albums.excessFor(1)).toBe(1);
  });
});

describe('the reconciliation', () => {
  it('reads the unread range of the chats that have unread messages', async () => {
    const albums = ledger();
    const { client, reads } = fakeClient([message(12, 7), message(11, 7), message(10, 7)]);

    await reconcileUnreadAlbums(client, [dialog()], albums);

    expect(reads).toEqual([{ chatId: 1, params: { minId: 9, maxId: 13, limit: 100 } }]);
    expect(albums.excessFor(1)).toBe(2);
    expect(albums.isReconciled()).toBe(true);
  });

  it('does not read again once the ledger is reconciled', async () => {
    const albums = ledger();
    const { client, reads } = fakeClient([message(12, 7)]);

    await reconcileUnreadAlbums(client, [dialog()], albums);
    await reconcileUnreadAlbums(client, [dialog()], albums);

    expect(reads).toHaveLength(1);
  });

  it('keeps the account’s own album members out of the ledger', async () => {
    const albums = ledger();
    const outgoing = message(12, 7);
    outgoing.raw.out = true;
    const { client } = fakeClient([outgoing]);

    await reconcileUnreadAlbums(client, [dialog()], albums);

    expect(albums.excessFor(1)).toBe(0);
  });
});

describe('the chat list the bridge serves', () => {
  it('counts an album once', async () => {
    const albums = ledger();
    const { client } = fakeClient([message(12, 7), message(11, 7), message(10, 7)]);

    const result = (await dispatchRpc(client, 'getDialogs', {}, albums, new CallRegistry())) as { dialogs: Array<{ unread: number }> };

    expect(result.dialogs[0].unread).toBe(1);
  });

  it('drops the members the server reports as read', async () => {
    const albums = ledger();
    albums.recordIncoming(1, 10, '77');
    albums.recordIncoming(1, 11, '77');

    // The account has read up to 10, so only the second member of the album is
    // unread and the album has no surplus left.
    const { client } = fakeClient([], { lastReadIngoing: 10 });
    const result = (await dispatchRpc(client, 'getDialogs', {}, albums, new CallRegistry())) as { dialogs: Array<{ unread: number }> };

    expect(result.dialogs[0].unread).toBe(3);
    expect(albums.excessFor(1)).toBe(0);
  });
});

describe('albumAwareUnread', () => {
  it('never goes below zero', () => {
    expect(albumAwareUnread(3, 2)).toBe(1);
    expect(albumAwareUnread(1, 2)).toBe(0);
    expect(albumAwareUnread(0, 0)).toBe(0);
  });
});
