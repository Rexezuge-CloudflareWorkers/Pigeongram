import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFileName, downloadMedia, isDownloadable } from '../../pages/src/media-download';
import type { MessageDto, MessageMediaDto } from '../../pages/src/types';

const photo: MessageMediaDto = {
  kind: 'photo',
  fileName: null,
  mime: null,
  size: 1000,
  width: 320,
  height: 240,
  duration: null,
};

const video: MessageMediaDto = {
  kind: 'video',
  fileName: 'clip.mp4',
  mime: 'video/x-matroska',
  size: 2048,
  width: 640,
  height: 360,
  duration: 12,
};

function message(media: MessageMediaDto | null, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 10,
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
    media,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('media downloads', () => {
  it('names a photo by its message id, because Telegram gives it no name', () => {
    expect(downloadFileName(message(photo))).toBe('photo-10.jpg');
  });

  it('keeps the name Telegram gives a file and derives one when it is absent', () => {
    expect(downloadFileName(message(video))).toBe('clip.mp4');
    expect(downloadFileName(message({ ...video, fileName: null }))).toBe('video-10.mkv');
  });

  it('downloads the original bytes, never the thumbnail', () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    downloadMedia(message(photo));

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.getAttribute('href')).toBe('/user/file?chatId=2&messageId=10');
    expect(clicked[0]?.getAttribute('href')).not.toContain('thumb=1');
    expect(clicked[0]?.getAttribute('download')).toBe('photo-10.jpg');
  });

  it('offers a download only for messages with file media', () => {
    expect(isDownloadable(message(photo))).toBe(true);
    expect(isDownloadable(message(null))).toBe(false);
  });
});
