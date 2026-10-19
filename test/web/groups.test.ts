import { describe, expect, it } from 'vitest';
import { albumCaption, groupMessages, isVisualAlbum } from '../../pages/src/groups';
import type { MessageDto, MessageMediaDto } from '../../pages/src/types';

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
    outgoing: false,
    date: 1_700_000_000_000,
    text: '',
    entities: [],
    reactions: [],
    service: false,
    media: null,
    poll: null,
    reply: null,
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
