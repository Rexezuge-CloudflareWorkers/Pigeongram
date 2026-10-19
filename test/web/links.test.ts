import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_LAUNCH_TIMEOUT_MS, findLinkedChat, launchTelegramApp, markedChatId, parseTelegramLink } from '../../pages/src/links';
import type { ChatDto, DialogDto } from '../../pages/src/types';

function chat(id: number, username: string | null): ChatDto {
  return { id, kind: 'user', title: `chat ${String(id)}`, username, photo: null, canSendMessages: true };
}

describe('parseTelegramLink', () => {
  it('reads a public username, however the host is spelled', () => {
    const expected = {
      chat: { username: 'durov' },
      postId: null,
      commentId: null,
      deepLink: 'tg://resolve?domain=durov',
      webUrl: 'https://t.me/durov',
    };
    expect(parseTelegramLink('https://t.me/Durov')).toEqual(expected);
    expect(parseTelegramLink('https://www.telegram.me/durov')).toEqual(expected);
    expect(parseTelegramLink('https://telegram.dog/durov')).toEqual(expected);
    expect(parseTelegramLink('  https://t.me/durov  ')).toEqual(expected);
  });

  it('reads a post and its comment', () => {
    expect(parseTelegramLink('https://t.me/durov/42?comment=7')).toEqual({
      chat: { username: 'durov' },
      postId: 42,
      commentId: 7,
      deepLink: 'tg://resolve?domain=durov&post=42&comment=7',
      webUrl: 'https://t.me/durov/42?comment=7',
    });
    // A comment only ever attaches to a post.
    expect(parseTelegramLink('https://t.me/durov?comment=7')?.commentId).toBeNull();
  });

  it('reads the channel-preview path as the channel itself', () => {
    expect(parseTelegramLink('https://t.me/s/durov')?.chat).toEqual({ username: 'durov' });
    expect(parseTelegramLink('https://t.me/s/durov/42')?.postId).toBe(42);
  });

  it('reads a private channel by its raw id, with no https fallback', () => {
    expect(parseTelegramLink('https://t.me/c/1234567890/55')).toEqual({
      chat: { internalId: 1_234_567_890 },
      postId: 55,
      commentId: null,
      deepLink: 'tg://privatepost?channel=1234567890&post=55',
      webUrl: null,
    });
    expect(parseTelegramLink('https://t.me/c/1234567890')?.postId).toBeNull();
  });

  it('reads invite and sticker links, which name no chat', () => {
    expect(parseTelegramLink('https://t.me/+AbCd-123')).toEqual({
      chat: null,
      postId: null,
      commentId: null,
      deepLink: 'tg://join?invite=AbCd-123',
      webUrl: 'https://t.me/+AbCd-123',
    });
    expect(parseTelegramLink('https://t.me/joinchat/AbCd-123')?.deepLink).toBe('tg://join?invite=AbCd-123');
    expect(parseTelegramLink('https://t.me/addstickers/UtyaDuck')).toEqual({
      chat: null,
      postId: null,
      commentId: null,
      deepLink: 'tg://addstickers?set=UtyaDuck',
      webUrl: 'https://t.me/addstickers/UtyaDuck',
    });
  });

  it('normalizes the tg:// forms to the same targets', () => {
    expect(parseTelegramLink('tg://resolve?domain=durov&post=5')).toEqual(parseTelegramLink('https://t.me/durov/5'));
    expect(parseTelegramLink('tg://privatepost?channel=1234567890&post=7')).toEqual(parseTelegramLink('https://t.me/c/1234567890/7'));
    expect(parseTelegramLink('tg://join?invite=abc')?.deepLink).toBe('tg://join?invite=abc');
    expect(parseTelegramLink('tg://addstickers?set=x')?.webUrl).toBe('https://t.me/addstickers/x');
  });

  it('passes an unknown tg:// operation through for the app to sort out', () => {
    expect(parseTelegramLink('tg://settings')).toEqual({
      chat: null,
      postId: null,
      commentId: null,
      deepLink: 'tg://settings',
      webUrl: null,
    });
  });

  it('leaves anything that is not a Telegram link to the browser', () => {
    for (const url of [
      'https://example.com/durov',
      'https://t.me/share/url?url=https%3A%2F%2Fexample.com',
      'https://t.me/proxy?server=x',
      'https://t.me/c/not-a-number',
      'https://t.me/durov/not-a-post',
      'mailto:a@b.co',
      'javascript:alert(1)',
      'tg-not-a-link',
      't.me/durov',
      '',
    ]) {
      expect(parseTelegramLink(url), url).toBeNull();
    }
  });
});

describe('findLinkedChat', () => {
  const dialogs: DialogDto[] = [
    { chat: chat(2, 'Bob'), lastMessage: null, unread: 0, readInboxMaxId: 0, pinned: false, muted: false },
    { chat: chat(markedChatId(1_234_567_890), null), lastMessage: null, unread: 0, readInboxMaxId: 0, pinned: false, muted: false },
    { chat: chat(4, null), lastMessage: null, unread: 0, readInboxMaxId: 0, pinned: false, muted: false },
  ];

  it('matches a username case-insensitively', () => {
    expect(findLinkedChat(dialogs, { username: 'bob' })).toBe(dialogs[0].chat);
    expect(findLinkedChat(dialogs, { username: 'nobody' })).toBeNull();
  });

  it('matches a private-channel id through its marked form', () => {
    expect(markedChatId(1_234_567_890)).toBe(-1_001_234_567_890);
    expect(findLinkedChat(dialogs, { internalId: 1_234_567_890 })).toBe(dialogs[1].chat);
    expect(findLinkedChat(dialogs, { internalId: 42 })).toBeNull();
  });
});

describe('launchTelegramApp', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const frame of document.querySelectorAll('iframe')) frame.remove();
  });

  it('loads the deep link in a hidden frame and reaches for the web only after the wait', () => {
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    vi.useFakeTimers();

    launchTelegramApp('tg://resolve?domain=durov', 'https://t.me/durov');
    const frame = document.querySelector('iframe');
    expect(frame?.hidden).toBe(true);
    expect(frame?.getAttribute('src')).toBe('tg://resolve?domain=durov');
    expect(open).not.toHaveBeenCalled();

    vi.advanceTimersByTime(APP_LAUNCH_TIMEOUT_MS);
    expect(open).toHaveBeenCalledWith('https://t.me/durov', '_blank', 'noopener,noreferrer');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('cancels the fallback once the app takes the tab over', () => {
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    vi.useFakeTimers();

    launchTelegramApp('tg://resolve?domain=durov', 'https://t.me/durov');
    globalThis.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(APP_LAUNCH_TIMEOUT_MS * 2);
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('opens no fallback for a link that has none', () => {
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    vi.useFakeTimers();

    launchTelegramApp('tg://privatepost?channel=1&post=2', null);
    vi.advanceTimersByTime(APP_LAUNCH_TIMEOUT_MS);
    expect(open).not.toHaveBeenCalled();
  });
});
