import { describe, expect, it } from 'vitest';
import {
  albumCaption,
  continuesAlbum,
  countUnreadGroups,
  countUnreadGroupsBetween,
  groupMessages,
  isVisualAlbum,
} from '../../apps/web/src/groups';
import type { DialogMessageDto, MessageDto, MessageMediaDto } from '../../apps/web/src/types';

const PHOTO: MessageMediaDto = {
  kind: 'photo',
  fileName: null,
  mime: null,
  size: null,
  width: 100,
  height: 100,
  duration: null,
};

const DOCUMENT: MessageMediaDto = { ...PHOTO, kind: 'document', fileName: 'notes.pdf', mime: 'application/pdf' };

function message(overrides: Partial<MessageDto> & { id: number }): MessageDto {
  return {
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
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

describe('groupMessages', () => {
  it('joins consecutive messages of one album into a single group', () => {
    const messages = [message({ id: 1 }), message({ id: 2, groupedId: '77' }), message({ id: 3, groupedId: '77' }), message({ id: 4 })];
    expect(groupMessages(messages).map((group) => group.map((entry) => entry.id))).toEqual([[1], [2, 3], [4]]);
  });

  it('keeps runs of the same album id apart when another message splits them', () => {
    const messages = [message({ id: 1, groupedId: '77' }), message({ id: 2 }), message({ id: 3, groupedId: '77' })];
    expect(groupMessages(messages).map((group) => group.length)).toEqual([1, 1, 1]);
  });

  it('keeps ungrouped messages as singletons', () => {
    expect(groupMessages([message({ id: 1 }), message({ id: 2 })]).map((group) => group.length)).toEqual([1, 1]);
  });
});

describe('albumCaption', () => {
  it('returns the only captioned member', () => {
    const caption = message({ id: 2, groupedId: '77', text: 'trip' });
    expect(albumCaption([message({ id: 1, groupedId: '77' }), caption])).toBe(caption);
  });

  it('returns null when no member or several members carry text', () => {
    expect(albumCaption([message({ id: 1, groupedId: '77' })])).toBeNull();
    expect(albumCaption([message({ id: 1, groupedId: '77', text: 'one' }), message({ id: 2, groupedId: '77', text: 'two' })])).toBeNull();
  });
});

describe('isVisualAlbum', () => {
  it('accepts photo, video and animation albums only', () => {
    expect(isVisualAlbum([message({ id: 1, media: PHOTO }), message({ id: 2, media: { ...PHOTO, kind: 'video' } })])).toBe(true);
    expect(isVisualAlbum([message({ id: 1, media: PHOTO }), message({ id: 2, media: DOCUMENT })])).toBe(false);
  });
});

/**
 * The chat list's view of the last message: an album's newest member, or a
 * message of its own.
 */
function dialogMessage(groupedId: string | null): DialogMessageDto {
  return {
    id: 1,
    date: 1_700_000_000_000,
    text: '',
    media: null,
    poll: null,
    outgoing: false,
    service: false,
    groupedId,
  };
}

describe('continuesAlbum', () => {
  it('recognises a message that continues the album the chat list counted', () => {
    expect(continuesAlbum(message({ id: 2, groupedId: '77' }), dialogMessage('77'))).toBe(true);
  });

  it('does not join a message that starts an album or stands alone', () => {
    expect(continuesAlbum(message({ id: 2, groupedId: '77' }), null)).toBe(false);
    expect(continuesAlbum(message({ id: 2, groupedId: '77' }), dialogMessage('88'))).toBe(false);
    expect(continuesAlbum(message({ id: 2 }), dialogMessage(null))).toBe(false);
  });
});

describe('countUnreadGroups', () => {
  it('counts an album once, however many of its members are in the set', () => {
    expect(countUnreadGroups([message({ id: 1, groupedId: '77' }), message({ id: 2, groupedId: '77' })])).toBe(1);
  });

  it('counts the messages of their own one by one', () => {
    expect(countUnreadGroups([message({ id: 1 }), message({ id: 2 })])).toBe(2);
  });

  it('counts the albums and the messages of their own together', () => {
    expect(countUnreadGroups([message({ id: 1, groupedId: '77' }), message({ id: 2, groupedId: '77' }), message({ id: 3 })])).toBe(2);
  });
});

describe('countUnreadGroupsBetween', () => {
  it('counts the incoming messages of the range, in albums', () => {
    const messages = [
      message({ id: 7, groupedId: '77' }),
      message({ id: 8, groupedId: '77' }),
      message({ id: 9, outgoing: true }),
      message({ id: 10 }),
    ];

    expect(countUnreadGroupsBetween(messages, 6, 10)).toBe(2);
    // A range that holds nothing unread counts for nothing.
    expect(countUnreadGroupsBetween(messages, 10, 12)).toBe(0);
  });
});
