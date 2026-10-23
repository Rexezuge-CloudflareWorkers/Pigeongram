import { getMarkedPeerId, Long, PeersIndex, RawUpdateInfo } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { encodeBase64 } from '../../worker/src/session/base64';
import { CallRegistry } from '../../worker/src/session/call-registry';
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

const callProtocol: tl.TypePhoneCallProtocol = {
  _: 'phoneCallProtocol',
  udpP2p: true,
  udpReflector: true,
  minLayer: 65,
  maxLayer: 92,
  libraryVersions: ['13.0.0'],
};

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

  it('maps a channel view update onto the marked chat id', () => {
    const event = mapRawUpdate(info({ _: 'updateChannelMessageViews', channelId: 20, id: 7, views: 1234 }));
    expect(event).toEqual({
      type: 'views',
      chatId: getMarkedPeerId(20, 'channel'),
      messageId: 7,
      views: 1234,
    });
  });

  it('maps a full poll update onto the poll DTO', () => {
    const event = mapRawUpdate(
      info({
        _: 'updateMessagePoll',
        peer: { _: 'peerUser', userId: 1 },
        msgId: 7,
        pollId: Long.fromNumber(1_234_567_890),
        poll: {
          _: 'poll',
          id: Long.fromNumber(1_234_567_890),
          question: { _: 'textWithEntities', text: 'Tea or coffee?', entities: [] },
          answers: [{ _: 'pollAnswer', text: { _: 'textWithEntities', text: 'Tea', entities: [] }, option: new Uint8Array([1]) }],
        },
        results: {
          _: 'pollResults',
          totalVoters: 1,
          results: [{ _: 'pollAnswerVoters', option: new Uint8Array([1]), voters: 1, chosen: true }],
        },
        pts: 9,
        ptsCount: 1,
      }),
    );
    expect(event).toMatchObject({
      type: 'poll',
      chatId: 1,
      messageId: 7,
      pollId: '1234567890',
      poll: {
        id: '1234567890',
        question: 'Tea or coffee?',
        totalVoters: 1,
        answers: [{ text: 'Tea', voters: 1, chosen: true, correct: null }],
      },
    });
  });

  it('passes a short poll update on as "recheck this poll"', () => {
    const event = mapRawUpdate(info({ _: 'updateMessagePoll', pollId: Long.fromNumber(1_234_567_890), pts: 10, ptsCount: 1 }));
    expect(event).toEqual({ type: 'poll', chatId: null, messageId: null, pollId: '1234567890', poll: null });
  });

  it('maps a public poll vote onto its poll id', () => {
    const event = mapRawUpdate(
      info({
        _: 'updateMessagePollVote',
        pollId: Long.fromNumber(1_234_567_890),
        peer: { _: 'peerChannel', channelId: 20 },
        options: [new Uint8Array([1])],
        pts: 11,
        ptsCount: 1,
      }),
    );
    expect(event).toEqual({
      type: 'poll',
      chatId: getMarkedPeerId(20, 'channel'),
      messageId: null,
      pollId: '1234567890',
      poll: null,
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
    expect(event).toEqual({ type: 'read', chatId: 1, maxId: 12, unread: 3, inbox: true });
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
    ).toEqual({ type: 'read', chatId: 1, maxId: 9, unread: 0, inbox: false });

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
    ).toEqual({ type: 'read', chatId: getMarkedPeerId(20, 'channel'), maxId: 99, unread: 0, inbox: true });

    expect(
      mapRawUpdate(
        info({
          _: 'updateReadChannelOutbox',
          channelId: 20,
          maxId: 98,
          pts: 7,
          ptsCount: 1,
        }),
      ),
    ).toEqual({ type: 'read', chatId: getMarkedPeerId(20, 'channel'), maxId: 98, unread: 0, inbox: false });
  });

  it('turns a presence change into a user_status event', () => {
    expect(mapRawUpdate(info({ _: 'updateUserStatus', userId: 1, status: { _: 'userStatusOnline' } }))).toEqual({
      type: 'user_status',
      userId: 1,
      presence: { status: 'online', lastSeenAt: null },
    });
    expect(mapRawUpdate(info({ _: 'updateUserStatus', userId: 1, status: { _: 'userStatusOffline', wasOnline: 1_700_000_000 } }))).toEqual({
      type: 'user_status',
      userId: 1,
      presence: { status: 'offline', lastSeenAt: 1_700_000_000_000 },
    });
  });

  it('reports an unknown status as no presence at all', () => {
    expect(mapRawUpdate(info({ _: 'updateUserStatus', userId: 1, status: { _: 'userStatusEmpty' } }))).toEqual({
      type: 'user_status',
      userId: 1,
      presence: null,
    });
  });

  it('ignores updates the bridge has no event for', () => {
    expect(mapRawUpdate(info({ _: 'updateUserTyping', userId: 1 }))).toBeNull();
  });

  it('turns a call update into a call event and remembers its access hash', () => {
    const calls = new CallRegistry();
    const event = mapRawUpdate(
      info({
        _: 'updatePhoneCall',
        phoneCall: {
          _: 'phoneCallRequested',
          id: Long.fromNumber(1000),
          accessHash: Long.fromNumber(555),
          date: 1_700_000_000,
          adminId: 1,
          participantId: 2,
          gAHash: new Uint8Array(32).fill(3),
          protocol: callProtocol,
        },
      }),
      calls,
    );

    expect(event?.type).toBe('call');
    const call = (event as { call: { id: string; state: string; gAHash: string | null } }).call;
    expect(call.id).toBe('1000');
    expect(call.state).toBe('requested');
    expect(call.gAHash).toBe(encodeBase64(new Uint8Array(32).fill(3)));
    // The hash never crosses the bridge, but the engine keeps it: the browser
    // names the call by its id alone.
    expect(calls.accessHash('1000')).toBe('555');
  });

  it('turns a signalling packet into an opaque call_signaling event', () => {
    const event = mapRawUpdate(
      info({
        _: 'updatePhoneCallSignalingData',
        phoneCallId: Long.fromNumber(1000),
        data: new Uint8Array([1, 2, 3]),
      }),
    );

    expect(event).toEqual({
      type: 'call_signaling',
      callId: '1000',
      data: encodeBase64(new Uint8Array([1, 2, 3])),
    });
  });
});
