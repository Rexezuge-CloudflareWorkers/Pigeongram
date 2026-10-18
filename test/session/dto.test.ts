import { Chat, getMarkedPeerId, Long, Message, PeersIndex, User } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { toChatDto, toMessageDto } from '../../worker/src/session/dto';

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

const rawBot = {
  ...rawUser,
  id: 5,
  bot: true,
  firstName: 'Helper',
  lastName: undefined,
  username: 'helper_bot',
} as unknown as tl.RawUser;

const rawGroup = {
  _: 'chat',
  id: 10,
  title: 'Old Group',
  participantsCount: 3,
  date: 1_700_000_000,
  version: 1,
} as unknown as tl.RawChat;

const rawUserWithPhoto = {
  ...rawUser,
  id: 3,
  firstName: 'Grace',
  lastName: 'Hopper',
  username: 'grace',
  accessHash: Long.fromNumber(3000),
  photo: { _: 'userProfilePhoto', photoId: Long.fromNumber(70), dcId: 2, hasVideo: false },
} as unknown as tl.RawUser;

const rawGroupWithPhoto = {
  ...rawGroup,
  id: 11,
  title: 'Photo Group',
  photo: { _: 'chatPhoto', photoId: Long.fromNumber(71), dcId: 2, hasVideo: false },
} as unknown as tl.RawChat;

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

const rawSupergroup = {
  _: 'channel',
  id: 30,
  title: 'Team',
  megagroup: true,
  broadcast: false,
  date: 1_700_000_000,
  accessHash: Long.fromNumber(30_000),
} as unknown as tl.RawChannel;

function index(): PeersIndex {
  return PeersIndex.from({
    users: [rawUser, rawBot],
    chats: [rawGroup, rawChannel, rawSupergroup],
  });
}

function message(overrides: Record<string, unknown>): Message {
  const raw = {
    _: 'message',
    id: 7,
    peerId: { _: 'peerUser', userId: 1 },
    fromId: { _: 'peerUser', userId: 1 },
    date: 1_700_000_000,
    message: 'hello',
    out: false,
    ...overrides,
  } as unknown as tl.RawMessage;
  return new Message(raw, index());
}

describe('toChatDto', () => {
  it('maps users, bots, groups, channels and supergroups', () => {
    expect(toChatDto(new User(rawUser))).toEqual({
      id: 1,
      kind: 'user',
      title: 'Ada Lovelace',
      username: 'ada',
      photo: null,
    });
    expect(toChatDto(new User(rawBot))).toEqual({
      id: 5,
      kind: 'bot',
      title: 'Helper',
      username: 'helper_bot',
      photo: null,
    });
    expect(toChatDto(new Chat(rawGroup))).toEqual({
      id: -10,
      kind: 'group',
      title: 'Old Group',
      username: null,
      photo: null,
    });
    expect(toChatDto(new Chat(rawChannel))).toEqual({
      id: getMarkedPeerId(20, 'channel'),
      kind: 'channel',
      title: 'Announcements',
      username: 'announce',
      photo: null,
    });
    expect(toChatDto(new Chat(rawSupergroup))).toEqual({
      id: getMarkedPeerId(30, 'channel'),
      kind: 'supergroup',
      title: 'Team',
      username: null,
      photo: null,
    });
  });

  it('carries the small photo as an opaque cache-busting token', () => {
    // The tokens are mtcute's `uniqueFileId`s for the fixtures above; pinning
    // them keeps the cache-busting contract (same bytes => same URL) testable.
    expect(toChatDto(new User(rawUserWithPhoto))).toEqual({
      id: 3,
      kind: 'user',
      title: 'Grace Hopper',
      username: 'grace',
      photo: 'AQADRgAI',
    });
    expect(toChatDto(new Chat(rawGroupWithPhoto))).toEqual({
      id: -11,
      kind: 'group',
      title: 'Photo Group',
      username: null,
      photo: 'AQADRwAI',
    });
  });

  it('falls back to no avatar when the peer has no usable access hash', () => {
    // `User.photo` builds an input peer internally and throws without an
    // access hash; the mapping must degrade to the initials fallback.
    const noAccessHash = { ...rawUserWithPhoto, accessHash: undefined } as unknown as tl.RawUser;
    expect(toChatDto(new User(noAccessHash)).photo).toBeNull();
  });
});

describe('toMessageDto', () => {
  it('maps a plain user message', () => {
    expect(toMessageDto(message({}))).toEqual({
      id: 7,
      chatId: 1,
      senderId: 1,
      senderName: 'Ada Lovelace',
      outgoing: false,
      date: 1_700_000_000_000,
      text: 'hello',
      service: false,
      media: null,
    });
  });

  it('flags outgoing and service messages', () => {
    expect(toMessageDto(message({ out: true })).outgoing).toBe(true);

    const service = new Message(
      {
        _: 'messageService',
        id: 8,
        peerId: { _: 'peerUser', userId: 1 },
        date: 1_700_000_100,
        action: { _: 'messageActionPinMessage' },
        out: false,
      } as unknown as tl.RawMessageService,
      index(),
    );
    const serviceDto = toMessageDto(service);
    expect(serviceDto.service).toBe(true);
    expect(serviceDto.text).toBe('');
    expect(serviceDto.id).toBe(8);
  });

  it('maps a photo message into the media DTO', () => {
    const photo = message({
      media: {
        _: 'messageMediaPhoto',
        photo: {
          _: 'photo',
          id: 5,
          accessHash: Long.fromNumber(55),
          fileReference: new Uint8Array([1, 2]),
          date: 1_700_000_000,
          dcId: 2,
          sizes: [{ _: 'photoSize', type: 'm', w: 320, h: 240, size: 1000 }],
        },
      },
    });
    expect(photo.media?.type).toBe('photo');
    expect(toMessageDto(photo).media).toEqual({
      kind: 'photo',
      fileName: null,
      mime: null,
      size: 1000,
      width: 320,
      height: 240,
      duration: null,
    });
  });

  it('maps a video document into the media DTO', () => {
    const video = message({
      media: {
        _: 'messageMediaDocument',
        document: {
          _: 'document',
          id: Long.fromNumber(9),
          accessHash: Long.fromNumber(99),
          fileReference: new Uint8Array([3]),
          date: 1_700_000_000,
          mimeType: 'video/mp4',
          size: 4096,
          dcId: 2,
          attributes: [
            { _: 'documentAttributeVideo', w: 1280, h: 720, duration: 12, supportsStreaming: true },
            { _: 'documentAttributeFilename', fileName: 'clip.mp4' },
          ],
        },
      },
    });
    expect(toMessageDto(video).media).toEqual({
      kind: 'video',
      fileName: 'clip.mp4',
      mime: 'video/mp4',
      size: 4096,
      width: 1280,
      height: 720,
      duration: 12,
    });
  });

  it('leaves non-file media out of the DTO', () => {
    const geo = message({
      media: {
        _: 'messageMediaGeo',
        geo: { _: 'geoPoint', lat: 51.5, long: -0.12, accuracyRadius: 5 },
      },
    });
    expect(toMessageDto(geo).media).toBeNull();
  });

  it('maps a channel message to the marked channel id', () => {
    const dto = toMessageDto(
      message({
        peerId: { _: 'peerChannel', channelId: 20 },
        fromId: null,
        message: 'news',
      }),
    );
    expect(dto.chatId).toBe(getMarkedPeerId(20, 'channel'));
    expect(dto.text).toBe('news');
  });
});
