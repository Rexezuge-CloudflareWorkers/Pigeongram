import { getMarkedPeerId, Long, PeersIndex, RawUpdateInfo } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { mapRawUpdate } from '../../worker/src/session/updates';

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
} as unknown as tl.RawUser;

const rawChannel = {
  _: 'channel',
  id: 20,
  title: 'Announcements',
  broadcast: true,
  megagroup: false,
  date: 1_700_000_000,
  accessHash: Long.fromNumber(20_000),
} as unknown as tl.RawChannel;

const peers = PeersIndex.from({ users: [rawUser], chats: [rawChannel] });

function info(update: Record<string, unknown>): RawUpdateInfo {
  return new RawUpdateInfo(update as unknown as tl.TypeUpdate, peers);
}

function rawMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _: 'message',
    id: 7,
    peerId: { _: 'peerUser', userId: 1 },
    fromId: { _: 'peerUser', userId: 1 },
    date: 1_700_000_000,
    message: 'hi',
    out: false,
    ...overrides,
  };
}

describe('mapRawUpdate', () => {
  it('turns new messages into new_message events', () => {
    const event = mapRawUpdate(info({ _: 'updateNewMessage', message: rawMessage(), pts: 1, ptsCount: 1 }));
    expect(event).toMatchObject({
      type: 'new_message',
      message: { id: 7, chatId: 1, text: 'hi' },
    });
  });

  it('handles channel messages with the marked channel id', () => {
    const event = mapRawUpdate(
      info({
        _: 'updateNewChannelMessage',
        message: rawMessage({ peerId: { _: 'peerChannel', channelId: 20 }, fromId: null }),
        pts: 2,
        ptsCount: 1,
      }),
    );
    expect(event).toMatchObject({
      type: 'new_message',
      message: { chatId: getMarkedPeerId(20, 'channel') },
    });
  });

  it('turns edit updates into edit_message events', () => {
    const event = mapRawUpdate(info({ _: 'updateEditMessage', message: rawMessage({ message: 'edited' }), pts: 3, ptsCount: 1 }));
    expect(event).toMatchObject({ type: 'edit_message', message: { text: 'edited' } });
  });

  it('maps reaction updates with the aggregate list', () => {
    const event = mapRawUpdate(
      info({
        _: 'updateMessageReactions',
        peer: { _: 'peerUser', userId: 1 },
        msgId: 7,
        reactions: {
          _: 'messageReactions',
          results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '🔥' }, count: 2, chosenOrder: 1 }],
        },
        pts: 7,
        ptsCount: 1,
      }),
    );
    expect(event).toEqual({
      type: 'reactions',
      chatId: 1,
      messageId: 7,
      reactions: [{ emoji: '🔥', customEmojiId: null, count: 2, chosen: true }],
    });

    const channelEvent = mapRawUpdate(
      info({
        _: 'updateMessageReactions',
        peer: { _: 'peerChannel', channelId: 20 },
        msgId: 9,
        reactions: { _: 'messageReactions', results: [] },
        pts: 8,
        ptsCount: 1,
      }),
    );
    expect(channelEvent).toEqual({
      type: 'reactions',
      chatId: getMarkedPeerId(20, 'channel'),
      messageId: 9,
      reactions: [],
    });
  });

  it('maps inbox reads with the remaining unread count', () => {
    const event = mapRawUpdate(
      info({
        _: 'updateReadHistoryInbox',
        peer: { _: 'peerUser', userId: 1 },
        maxId: 12,
        stillUnreadCount: 3,
        pts: 4,
        ptsCount: 1,
      }),
    );
    expect(event).toEqual({ type: 'read', chatId: 1, maxId: 12, unread: 3 });
  });

  it('maps outbox and channel reads onto marked ids', () => {
    expect(
      mapRawUpdate(
        info({
          _: 'updateReadHistoryOutbox',
          peer: { _: 'peerUser', userId: 1 },
          maxId: 9,
          pts: 5,
          ptsCount: 1,
        }),
      ),
    ).toEqual({ type: 'read', chatId: 1, maxId: 9, unread: 0 });

    expect(
      mapRawUpdate(
        info({
          _: 'updateReadChannelInbox',
          channelId: 20,
          maxId: 99,
          stillUnreadCount: 0,
          pts: 6,
          ptsCount: 1,
        }),
      ),
    ).toEqual({ type: 'read', chatId: getMarkedPeerId(20, 'channel'), maxId: 99, unread: 0 });
  });

  it('ignores updates the bridge has no event for', () => {
    expect(mapRawUpdate(info({ _: 'updateUserStatus', userId: 1, status: { _: 'userStatusOffline' } }))).toBeNull();
  });
});
