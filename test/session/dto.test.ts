import { Chat, Dialog, getMarkedPeerId, Long, Message, PeersIndex, User } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { toChatDto, toDialogDto, toMessageDto } from '../../worker/src/session/dto';

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
    users: [rawUser, rawUserWithPhoto, rawBot],
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

const POLL_ID = Long.fromNumber(1_234_567_890);

const POLL_ANSWERS = [
  { _: 'pollAnswer', text: { _: 'textWithEntities', text: 'Tea', entities: [] }, option: new Uint8Array([1]) },
  { _: 'pollAnswer', text: { _: 'textWithEntities', text: 'Coffee', entities: [] }, option: new Uint8Array([2]) },
];

const POLL_RESULTS = {
  _: 'pollResults',
  totalVoters: 3,
  results: [
    { _: 'pollAnswerVoters', option: new Uint8Array([1]), voters: 2, chosen: true },
    { _: 'pollAnswerVoters', option: new Uint8Array([2]), voters: 1 },
  ],
};

/**
A poll message: `messageMediaPoll` over the two answers above, with the raw
poll flags overridable and the results omittable (the shape a poll nobody has
voted in, or one that hides them until it closes, arrives as).
*/
function pollMessage(poll: Record<string, unknown> = {}, results: Record<string, unknown> | null = POLL_RESULTS): Message {
  return message({
    media: {
      _: 'messageMediaPoll',
      poll: {
        _: 'poll',
        id: POLL_ID,
        question: { _: 'textWithEntities', text: 'Tea or coffee?', entities: [] },
        answers: POLL_ANSWERS,
        ...poll,
      },
      ...(results !== null && { results }),
    },
  });
}

describe('toChatDto', () => {
  it('maps users, bots, groups, channels and supergroups', () => {
    expect(toChatDto(new User(rawUser))).toEqual({
      id: 1,
      kind: 'user',
      title: 'Ada Lovelace',
      username: 'ada',
      photo: null,
      canSendMessages: true,
      presence: null,
    });
    expect(toChatDto(new User(rawBot))).toEqual({
      id: 5,
      kind: 'bot',
      title: 'Helper',
      username: 'helper_bot',
      photo: null,
      canSendMessages: true,
      presence: null,
    });
    expect(toChatDto(new Chat(rawGroup))).toEqual({
      id: -10,
      kind: 'group',
      title: 'Old Group',
      username: null,
      photo: null,
      canSendMessages: true,
      presence: null,
    });
    expect(toChatDto(new Chat(rawChannel))).toEqual({
      id: getMarkedPeerId(20, 'channel'),
      kind: 'channel',
      title: 'Announcements',
      username: 'announce',
      photo: null,
      canSendMessages: false,
      presence: null,
    });
    expect(toChatDto(new Chat(rawSupergroup))).toEqual({
      id: getMarkedPeerId(30, 'channel'),
      kind: 'supergroup',
      title: 'Team',
      username: null,
      photo: null,
      canSendMessages: true,
      presence: null,
    });
  });

  it('marks broadcast channels writable only for the creator or a poster admin', () => {
    const admin = { ...rawChannel, adminRights: { _: 'chatAdminRights', postMessages: true } } as unknown as tl.RawChannel;
    expect(toChatDto(new Chat(admin)).canSendMessages).toBe(true);

    const adminWithoutPost = { ...rawChannel, adminRights: { _: 'chatAdminRights', pinMessages: true } } as unknown as tl.RawChannel;
    expect(toChatDto(new Chat(adminWithoutPost)).canSendMessages).toBe(false);

    const creator = { ...rawChannel, creator: true } as unknown as tl.RawChannel;
    expect(toChatDto(new Chat(creator)).canSendMessages).toBe(true);
  });

  it('blocks sending when the account was restricted or the defaults ban it', () => {
    const banned = {
      ...rawSupergroup,
      bannedRights: { _: 'chatBannedRights', sendMessages: true, untilDate: 0 },
    } as unknown as tl.RawChannel;
    expect(toChatDto(new Chat(banned)).canSendMessages).toBe(false);

    const defaultBanned = {
      ...rawSupergroup,
      defaultBannedRights: { _: 'chatBannedRights', sendMessages: true, untilDate: 0 },
    } as unknown as tl.RawChannel;
    expect(toChatDto(new Chat(defaultBanned)).canSendMessages).toBe(false);

    // An admin is exempt from the default rights.
    const admin = {
      ...rawSupergroup,
      adminRights: { _: 'chatAdminRights', changeInfo: true },
      defaultBannedRights: { _: 'chatBannedRights', sendMessages: true, untilDate: 0 },
    } as unknown as tl.RawChannel;
    expect(toChatDto(new Chat(admin)).canSendMessages).toBe(true);
  });

  it('keeps an incomplete (min) peer writable rather than guessing', () => {
    const min = { ...rawChannel, min: true } as unknown as tl.RawChannel;
    expect(toChatDto(new Chat(min)).canSendMessages).toBe(true);
  });

  it('lets a monoforum subscriber write to the channel admins', () => {
    const monoforum = { ...rawChannel, monoforum: true } as unknown as tl.RawChannel;
    expect(toChatDto(new Chat(monoforum)).canSendMessages).toBe(true);
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
      canSendMessages: true,
      presence: null,
    });
    expect(toChatDto(new Chat(rawGroupWithPhoto))).toEqual({
      id: -11,
      kind: 'group',
      title: 'Photo Group',
      username: null,
      photo: 'AQADRwAI',
      canSendMessages: true,
      presence: null,
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
      groupedId: null,
      senderId: 1,
      senderName: 'Ada Lovelace',
      senderPhoto: null,
      outgoing: false,
      date: 1_700_000_000_000,
      text: 'hello',
      entities: [],
      reactions: [],
      service: false,
      media: null,
      poll: null,
      markup: null,
      reply: null,
      forward: null,
      views: null,
      comments: null,
    });
  });

  it("carries the sender's avatar version token", () => {
    const dto = toMessageDto(message({ fromId: { _: 'peerUser', userId: 3 } }));
    expect(dto.senderPhoto).toBe('AQADRgAI');
  });

  it('maps an inline keyboard into rows of button actions', () => {
    const dto = toMessageDto(
      message({
        replyMarkup: {
          _: 'replyInlineMarkup',
          rows: [
            {
              _: 'keyboardInlineButtonRow',
              buttons: [
                {
                  _: 'keyboardInlineButton',
                  text: 'Create',
                  style: { _: 'keyboardButtonStyle', bgPrimary: true },
                  type: { _: 'inlineButtonTypeCallback', data: new Uint8Array([1, 2, 3]) },
                },
                {
                  _: 'keyboardInlineButton',
                  text: 'Docs',
                  type: { _: 'inlineButtonTypeUrl', url: 'https://example.com/docs' },
                },
              ],
            },
            {
              _: 'keyboardInlineButtonRow',
              buttons: [
                {
                  _: 'keyboardInlineButton',
                  text: 'Copy token',
                  type: { _: 'inlineButtonTypeCopy', copyText: 'token-123' },
                },
                {
                  _: 'keyboardInlineButton',
                  text: 'Locked',
                  type: { _: 'inlineButtonTypeCallback', data: new Uint8Array([4]), requiresPassword: true },
                },
                { _: 'keyboardInlineButton', text: 'Play', type: { _: 'inlineButtonTypeGame' } },
              ],
            },
          ],
        },
      }),
    );

    expect(dto.markup).toEqual({
      rows: [
        [
          { text: 'Create', style: 'primary', kind: 'callback', data: 'AQID', requiresPassword: false },
          { text: 'Docs', style: null, kind: 'url', url: 'https://example.com/docs' },
        ],
        [
          { text: 'Copy token', style: null, kind: 'copy', copyText: 'token-123' },
          { text: 'Locked', style: null, kind: 'callback', data: 'BA==', requiresPassword: true },
          { text: 'Play', style: null, kind: 'game' },
        ],
      ],
    });
  });

  it('leaves reply keyboards to the composer', () => {
    const dto = toMessageDto(
      message({
        replyMarkup: {
          _: 'replyKeyboardMarkup',
          rows: [
            {
              _: 'keyboardButtonRow',
              buttons: [{ _: 'keyboardButton', text: 'Yes', type: { _: 'buttonTypeDefault' } }],
            },
          ],
        },
      }),
    );
    expect(dto.markup).toBeNull();
  });

  it('carries album membership as a decimal string', () => {
    expect(toMessageDto(message({ groupedId: Long.fromString('1234567890123456789') })).groupedId).toBe('1234567890123456789');
  });

  it("maps a channel post's replies header into the comments DTO", () => {
    const dto = toMessageDto(
      message({
        peerId: { _: 'peerChannel', channelId: 20 },
        fromId: null,
        message: 'news',
        replies: {
          _: 'messageReplies',
          comments: true,
          replies: 3,
          channelId: 30,
          maxId: 12,
          readMaxId: 11,
          recentRepliers: [],
        },
      }),
    );
    expect(dto.comments).toEqual({
      hasComments: true,
      count: 3,
      discussionChatId: getMarkedPeerId(30, 'channel'),
    });
  });

  it('leaves posts without a replies header without comment metadata', () => {
    const dto = toMessageDto(message({ peerId: { _: 'peerChannel', channelId: 20 }, fromId: null }));
    expect(dto.comments).toBeNull();
  });

  it("carries a channel post's view count, and none for other messages", () => {
    const post = toMessageDto(message({ peerId: { _: 'peerChannel', channelId: 20 }, fromId: null, views: 1234 }));
    expect(post.views).toBe(1234);
    expect(toMessageDto(message({})).views).toBeNull();
  });

  it('maps a same-chat reply header, which carries only the message id', () => {
    const dto = toMessageDto(
      message({
        replyTo: { _: 'messageReplyHeader', replyToMsgId: 3 },
      }),
    );
    expect(dto.reply).toEqual({
      origin: 'same_chat',
      messageId: 3,
      chatId: null,
      senderName: null,
      date: null,
      text: '',
      entities: [],
      mediaKind: null,
      quote: false,
    });
  });

  it('maps a quote reply with its text and entities', () => {
    const dto = toMessageDto(
      message({
        replyTo: {
          _: 'messageReplyHeader',
          replyToMsgId: 3,
          quote: true,
          quoteText: 'excerpt',
          quoteEntities: [{ _: 'messageEntityBold', offset: 0, length: 7 }],
        },
      }),
    );
    expect(dto.reply?.quote).toBe(true);
    expect(dto.reply?.text).toBe('excerpt');
    expect(dto.reply?.entities).toEqual([{ offset: 0, length: 7, kind: 'bold' }]);
  });

  it('maps a cross-chat reply with sender, date and media kind', () => {
    const dto = toMessageDto(
      message({
        replyTo: {
          _: 'messageReplyHeader',
          replyToMsgId: 3,
          replyToPeerId: { _: 'peerChannel', channelId: 20 },
          replyFrom: { _: 'messageFwdHeader', date: 1_700_000_000, fromId: { _: 'peerUser', userId: 1 } },
          replyMedia: {
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
        },
      }),
    );
    expect(dto.reply).toEqual({
      origin: 'other_chat',
      messageId: 3,
      chatId: getMarkedPeerId(20, 'channel'),
      senderName: 'Ada Lovelace',
      date: 1_700_000_000_000,
      text: '',
      entities: [],
      mediaKind: 'photo',
      quote: false,
    });
  });

  it('maps a private-thread reply header to a named sender', () => {
    const dto = toMessageDto(
      message({
        replyTo: {
          _: 'messageReplyHeader',
          replyFrom: { _: 'messageFwdHeader', date: 1_700_000_000, fromName: 'Anonymous' },
        },
      }),
    );
    expect(dto.reply).toEqual({
      origin: 'private',
      messageId: null,
      chatId: null,
      senderName: 'Anonymous',
      date: 1_700_000_000_000,
      text: '',
      entities: [],
      mediaKind: null,
      quote: false,
    });
  });

  it('maps a channel forward with its origin, original post and signature', () => {
    const dto = toMessageDto(
      message({
        fwdFrom: {
          _: 'messageFwdHeader',
          date: 1_700_000_000,
          fromId: { _: 'peerChannel', channelId: 20 },
          channelPost: 4,
          postAuthor: 'Ada',
        },
      }),
    );
    expect(dto.forward).toEqual({
      senderId: getMarkedPeerId(20, 'channel'),
      senderName: 'Announcements',
      senderUsername: 'announce',
      date: 1_700_000_000_000,
      fromChatId: null,
      fromMessageId: 4,
      signature: 'Ada',
    });
  });

  it('maps a hidden forward to the name the header carries', () => {
    const dto = toMessageDto(message({ fwdFrom: { _: 'messageFwdHeader', date: 1_700_000_000, fromName: 'Anonymous' } }));
    expect(dto.forward).toEqual({
      senderId: null,
      senderName: 'Anonymous',
      senderUsername: null,
      date: 1_700_000_000_000,
      fromChatId: null,
      fromMessageId: null,
      signature: null,
    });
  });

  it('maps a saved-messages forward to the original chat and message', () => {
    const dto = toMessageDto(
      message({
        fwdFrom: {
          _: 'messageFwdHeader',
          date: 1_700_000_000,
          fromId: { _: 'peerUser', userId: 1 },
          savedFromPeer: { _: 'peerChannel', channelId: 20 },
          savedFromMsgId: 99,
        },
      }),
    );
    expect(dto.forward).toMatchObject({
      senderName: 'Ada Lovelace',
      senderUsername: 'ada',
      fromChatId: getMarkedPeerId(20, 'channel'),
      fromMessageId: 99,
    });
  });

  it('keeps a forward whose header names neither sender', () => {
    const dto = toMessageDto(message({ fwdFrom: { _: 'messageFwdHeader', date: 1_700_000_000 } }));
    expect(dto.forward).toEqual({
      senderId: null,
      senderName: null,
      senderUsername: null,
      date: 1_700_000_000_000,
      fromChatId: null,
      fromMessageId: null,
      signature: null,
    });
  });

  it('maps rich-text entities', () => {
    const dto = toMessageDto(
      message({
        message: 'hello world ts abc def',
        entities: [
          { _: 'messageEntityBold', offset: 0, length: 5 },
          { _: 'messageEntityTextUrl', offset: 6, length: 5, url: 'https://example.com' },
          { _: 'messageEntityPre', offset: 12, length: 2, language: 'ts' },
          { _: 'messageEntityMentionName', offset: 15, length: 3, userId: 1 },
          { _: 'messageEntitySpoiler', offset: 19, length: 3 },
        ],
      }),
    );
    expect(dto.entities).toEqual([
      { offset: 0, length: 5, kind: 'bold' },
      { offset: 6, length: 5, kind: 'text_link', url: 'https://example.com' },
      { offset: 12, length: 2, kind: 'pre', language: 'ts' },
      { offset: 15, length: 3, kind: 'text_mention', userId: 1 },
      { offset: 19, length: 3, kind: 'spoiler' },
    ]);
  });

  it('maps reaction aggregates, including custom emoji and the chosen state', () => {
    const dto = toMessageDto(
      message({
        reactions: {
          _: 'messageReactions',
          results: [
            { _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 3 },
            { _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '🔥' }, count: 1, chosenOrder: 2 },
            {
              _: 'reactionCount',
              reaction: { _: 'reactionCustomEmoji', documentId: Long.fromNumber(42) },
              count: 2,
            },
          ],
        },
      }),
    );
    expect(dto.reactions).toEqual([
      { emoji: '👍', customEmojiId: null, count: 3, chosen: false },
      { emoji: '🔥', customEmojiId: null, count: 1, chosen: true },
      { emoji: null, customEmojiId: '42', count: 2, chosen: false },
    ]);
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

  it('fills the auto-delete service message text', () => {
    const service = new Message(
      {
        _: 'messageService',
        id: 9,
        peerId: { _: 'peerUser', userId: 1 },
        date: 1_700_000_100,
        action: { _: 'messageActionSetMessagesTTL', period: 2_678_400 },
        out: true,
      } as unknown as tl.RawMessageService,
      index(),
    );
    expect(toMessageDto(service).text).toBe('You set messages to auto-delete in 1 month');
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

  it('maps a sticker document into the media DTO with its size', () => {
    const sticker = message({
      media: {
        _: 'messageMediaDocument',
        document: {
          _: 'document',
          id: Long.fromNumber(10),
          accessHash: Long.fromNumber(100),
          fileReference: new Uint8Array([4]),
          date: 1_700_000_000,
          mimeType: 'image/webp',
          size: 2048,
          dcId: 2,
          attributes: [
            { _: 'documentAttributeSticker', alt: '🙂', stickerset: { _: 'inputStickerSetEmpty' } },
            { _: 'documentAttributeImageSize', w: 512, h: 512 },
          ],
        },
      },
    });
    expect(toMessageDto(sticker).media).toEqual({
      kind: 'sticker',
      fileName: null,
      mime: 'image/webp',
      size: 2048,
      width: 512,
      height: 512,
      duration: null,
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

  it('maps a poll beside media, with the results Telegram shared', () => {
    const dto = toMessageDto(pollMessage());
    expect(dto.media).toBeNull();
    expect(dto.poll).toEqual({
      id: '1234567890',
      question: 'Tea or coffee?',
      answers: [
        { text: 'Tea', voters: 2, chosen: true, correct: null },
        { text: 'Coffee', voters: 1, chosen: false, correct: null },
      ],
      totalVoters: 3,
      closed: false,
      quiz: false,
      multiple: false,
      revotingDisabled: false,
      hideResultsUntilClose: false,
      solution: null,
    });
  });

  it('keeps unknown poll results null rather than zero', () => {
    const dto = toMessageDto(pollMessage({}, null));
    expect(dto.poll?.answers.map((answer) => answer.voters)).toEqual([null, null]);
    expect(dto.poll?.answers.map((answer) => answer.correct)).toEqual([null, null]);
    expect(dto.poll?.answers.map((answer) => answer.chosen)).toEqual([false, false]);
    expect(dto.poll?.totalVoters).toBeNull();
  });

  it('carries the poll flags', () => {
    const dto = toMessageDto(
      pollMessage({ closed: true, multipleChoice: true, revotingDisabled: true, hideResultsUntilClose: true, publicVoters: true }),
    );
    expect(dto.poll).toMatchObject({
      closed: true,
      multiple: true,
      revotingDisabled: true,
      hideResultsUntilClose: true,
    });
  });

  it('maps a quiz answer and its solution once the results are known', () => {
    const dto = toMessageDto(
      pollMessage(
        { quiz: true, revotingDisabled: true },
        {
          _: 'pollResults',
          totalVoters: 3,
          solution: 'Coffee, obviously.',
          results: [
            { _: 'pollAnswerVoters', option: new Uint8Array([1]), voters: 0 },
            { _: 'pollAnswerVoters', option: new Uint8Array([2]), voters: 3, correct: true },
          ],
        },
      ),
    );
    expect(dto.poll).toMatchObject({ quiz: true, revotingDisabled: true, solution: 'Coffee, obviously.' });
    expect(dto.poll?.answers[1]).toEqual({ text: 'Coffee', voters: 3, chosen: false, correct: true });
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

describe('toDialogDto', () => {
  it('carries the unread count and the read watermark the thread opens at', () => {
    const raw = {
      _: 'dialog',
      peer: { _: 'peerUser', userId: 1 },
      unreadCount: 3,
      readInboxMaxId: 12,
      readOutboxMaxId: 7,
      pinned: false,
      notifySettings: { _: 'peerNotifySettings', silent: false },
    } as unknown as tl.RawDialog;
    const dto = toDialogDto(new Dialog(raw, index(), new Map()));
    expect(dto).toEqual({
      chat: { id: 1, kind: 'user', title: 'Ada Lovelace', username: 'ada', photo: null, canSendMessages: true, presence: null },
      lastMessage: null,
      unread: 3,
      readInboxMaxId: 12,
      readOutboxMaxId: 7,
      pinned: false,
      muted: false,
      archived: false,
    });
  });

  it('reads a dialog with no watermark as never read', () => {
    const raw = {
      _: 'dialog',
      peer: { _: 'peerUser', userId: 1 },
      notifySettings: { _: 'peerNotifySettings', silent: false },
    } as unknown as tl.RawDialog;
    const dto = toDialogDto(new Dialog(raw, index(), new Map()));
    expect(dto.readInboxMaxId).toBe(0);
    expect(dto.readOutboxMaxId).toBe(0);
  });

  it('marks a dialog that sits in the archive', () => {
    // The archive is Telegram's peer folder 1; every other chat is in folder 0.
    const raw = {
      _: 'dialog',
      peer: { _: 'peerUser', userId: 1 },
      folderId: 1,
      notifySettings: { _: 'peerNotifySettings', silent: false },
    } as unknown as tl.RawDialog;
    expect(toDialogDto(new Dialog(raw, index(), new Map())).archived).toBe(true);
  });

  it('takes the unread count the caller corrected', () => {
    // Telegram counts every album member; the album ledger corrects the count
    // so that an album counts once.
    const raw = {
      _: 'dialog',
      peer: { _: 'peerUser', userId: 1 },
      unreadCount: 3,
      notifySettings: { _: 'peerNotifySettings', silent: false },
    } as unknown as tl.RawDialog;
    expect(toDialogDto(new Dialog(raw, index(), new Map()), 1).unread).toBe(1);
  });

  it('carries the album membership of the last message', () => {
    const raw = {
      _: 'dialog',
      peer: { _: 'peerUser', userId: 1 },
      notifySettings: { _: 'peerNotifySettings', silent: false },
    } as unknown as tl.RawDialog;
    const last = {
      _: 'message',
      id: 13,
      peerId: { _: 'peerUser', userId: 1 },
      fromId: { _: 'peerUser', userId: 1 },
      date: 1_700_000_000,
      message: 'notes.pdf',
      out: false,
      groupedId: Long.fromNumber(77),
    } as unknown as tl.RawMessage;
    const dto = toDialogDto(new Dialog(raw, index(), new Map([[1, last]])));
    expect(dto.lastMessage?.groupedId).toBe('77');
  });
});
