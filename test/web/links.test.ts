import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_LAUNCH_TIMEOUT_MS,
  commentWebLink,
  findLinkedChat,
  forwardOriginLink,
  launchTelegramApp,
  markedChatId,
  messageWebLink,
  miniAppDeepLink,
  parseTelegramLink,
  usernameAppLink,
} from '../../apps/web/src/links';
import type { ChatDto, DialogDto, MessageForwardDto } from '../../apps/web/src/types';

function chat(id: number, username: string | null): ChatDto {
  return { id, kind: 'user', title: `chat ${String(id)}`, username, photo: null, canSendMessages: true, presence: null };
}

/**
A peer of any kind, for the address builders that care about the kind.
*/
function peer(id: number, username: string | null, kind: ChatDto['kind'] = 'channel'): ChatDto {
  return { id, kind, title: `chat ${String(id)}`, username, photo: null, canSendMessages: true, presence: null };
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

describe('miniAppDeepLink', () => {
  it('turns a Main Mini App link into the resolve deep link', () => {
    expect(miniAppDeepLink('https://t.me/BotFather?startapp=abc&mode=compact')).toBe(
      'tg://resolve?domain=botfather&startapp=abc&mode=compact',
    );
    expect(miniAppDeepLink('https://t.me/BotFather?startapp')).toBe('tg://resolve?domain=botfather&startapp');
  });

  it('turns a direct Mini App link into the resolve deep link', () => {
    expect(miniAppDeepLink('https://t.me/BotFather/create')).toBe('tg://resolve?domain=botfather&appname=create');
    expect(miniAppDeepLink('https://t.me/BotFather/create?startapp=abc')).toBe('tg://resolve?domain=botfather&appname=create&startapp=abc');
  });

  it('leaves ordinary chat, post and non-Telegram links alone', () => {
    expect(miniAppDeepLink('https://t.me/durov')).toBeNull();
    expect(miniAppDeepLink('https://t.me/BotFather/123')).toBeNull();
    expect(miniAppDeepLink('https://t.me/share/url?url=https%3A%2F%2Fexample.com')).toBeNull();
    expect(miniAppDeepLink('https://example.com/BotFather?startapp=abc')).toBeNull();
    expect(miniAppDeepLink('not a link')).toBeNull();
  });
});

describe('findLinkedChat', () => {
  const dialogs: DialogDto[] = [
    {
      chat: chat(2, 'Bob'),
      lastMessage: null,
      unread: 0,
      readInboxMaxId: 0,
      readOutboxMaxId: 0,
      pinned: false,
      muted: false,
      archived: false,
    },
    {
      chat: chat(markedChatId(1_234_567_890), null),
      lastMessage: null,
      unread: 0,
      readInboxMaxId: 0,
      readOutboxMaxId: 0,
      pinned: false,
      muted: false,
      archived: false,
    },
    {
      chat: chat(4, null),
      lastMessage: null,
      unread: 0,
      readInboxMaxId: 0,
      readOutboxMaxId: 0,
      pinned: false,
      muted: false,
      archived: false,
    },
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

describe('messageWebLink', () => {
  it('links a public channel post by its username', () => {
    expect(messageWebLink(peer(-1_000_000_000_020, 'announce'), 7)).toBe('https://t.me/announce/7');
  });

  it('links a private supergroup post through its raw id', () => {
    expect(messageWebLink(peer(-1_000_000_000_030, null, 'supergroup'), 42)).toBe('https://t.me/c/30/42');
  });

  it('has no message link for a user chat or a basic group', () => {
    expect(messageWebLink(chat(2, 'bob'), 10)).toBeNull();
    expect(messageWebLink(peer(-3, 'team', 'group'), 10)).toBeNull();
  });
});

describe('commentWebLink', () => {
  it('names the discussion message in the query', () => {
    expect(commentWebLink(peer(-1_000_000_000_020, 'announce'), 7, 11)).toBe('https://t.me/announce/7?comment=11');
  });

  it('is null when the channel has no message link', () => {
    expect(commentWebLink(chat(2, 'bob'), 7, 11)).toBeNull();
  });
});

describe('forwardOriginLink', () => {
  function forward(overrides: Partial<MessageForwardDto>): MessageForwardDto {
    return {
      senderId: null,
      senderName: null,
      senderUsername: null,
      date: 0,
      fromChatId: null,
      fromMessageId: null,
      signature: null,
      ...overrides,
    };
  }

  it('prefers a public username, which has a web fallback too', () => {
    expect(forwardOriginLink(forward({ senderId: 42, senderUsername: 'carol' }))).toEqual({
      chat: { username: 'carol' },
      postId: null,
      commentId: null,
      deepLink: 'tg://resolve?domain=carol',
      webUrl: 'https://t.me/carol',
    });
  });

  it('addresses a user without a username by id', () => {
    expect(forwardOriginLink(forward({ senderId: 42 }))).toMatchObject({
      deepLink: 'tg://user?id=42',
      webUrl: null,
    });
  });

  it('addresses a private channel through its marked id', () => {
    const id = markedChatId(1_234_567_890);
    expect(forwardOriginLink(forward({ senderId: id }))).toMatchObject({
      deepLink: 'tg://privatepost?channel=1234567890',
      webUrl: null,
    });
  });

  it('falls back to the saved-messages source chat', () => {
    expect(forwardOriginLink(forward({ senderId: null, fromChatId: markedChatId(7) }))).toMatchObject({
      deepLink: 'tg://privatepost?channel=7',
    });
  });

  it('returns null for a hidden sender or a basic group', () => {
    expect(forwardOriginLink(forward({ senderId: null, senderName: 'Anonymous' }))).toBeNull();
    expect(forwardOriginLink(forward({ senderId: -42 }))).toBeNull();
  });
});

describe('usernameAppLink', () => {
  it('names the app and the browser address of a public chat', () => {
    expect(usernameAppLink('durov')).toEqual({
      deepLink: 'tg://resolve?domain=durov',
      webUrl: 'https://t.me/durov',
    });
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
