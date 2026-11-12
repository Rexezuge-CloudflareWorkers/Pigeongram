import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { ServiceError } from '@rexezuge/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDto, DialogDto } from '../../apps/web/src/types';

const api = vi.hoisted(() => ({
  resolveChat: vi.fn(),
  resolveInvite: vi.fn(),
  joinInvite: vi.fn(),
}));
const linkUtils = vi.hoisted(() => ({
  parseTelegramLink: vi.fn(),
  findLinkedChat: vi.fn(),
  handOffTarget: vi.fn(),
  launchTelegramApp: vi.fn(),
  linkTarget: vi.fn(),
}));

vi.mock('../../apps/web/src/api', () => api);
vi.mock('../../apps/web/src/links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/src/links')>();
  return { ...actual, ...linkUtils };
});

const { useLinkRouting } = await import('../../apps/web/src/useLinkRouting');

function chat(id: number, username: string | null = null): ChatDto {
  return {
    id,
    kind: 'channel',
    title: `Chat ${String(id)}`,
    username,
    photo: null,
    canSendMessages: true,
    canDeleteMessages: true,
    presence: null,
  };
}

function dialog(id: number): DialogDto {
  return {
    chat: chat(id),
    lastMessage: null,
    unread: 0,
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
    archived: false,
  };
}

class TestServiceError extends ServiceError {}

beforeEach(() => {
  vi.clearAllMocks();
  linkUtils.linkTarget.mockImplementation((c: { username?: string; internalId?: number }) =>
    c.username ? { username: c.username } : { chatId: -1_000_000_000_000 - (c.internalId ?? 0) },
  );
});

afterEach(cleanup);

describe('useLinkRouting', () => {
  function setup(dialogs: DialogDto[] = []) {
    const openChat = vi.fn();
    const registerChat = vi.fn();
    const setPreview = vi.fn();
    const reload = vi.fn(async () => {});
    const onError = vi.fn();
    const onNotice = vi.fn();
    const hook = renderHook(() =>
      useLinkRouting({
        dialogs,
        resolutionRef: { current: 0 },
        openChat,
        registerChat,
        setPreview,
        reload,
        onError,
        onNotice,
      }),
    );
    return { ...hook, openChat, registerChat, setPreview, reload, onError, onNotice };
  }

  it('returns false for non-Telegram links', () => {
    linkUtils.parseTelegramLink.mockReturnValue(null);
    const { result } = setup();
    let handled = true;
    act(() => {
      handled = result.current.handleTelegramLink('https://example.com');
    });
    expect(handled).toBe(false);
  });

  it('opens invite links through the invite flow', () => {
    const link = {
      chat: null,
      invite: 'abc',
      postId: null,
      commentId: null,
      deepLink: 'tg://join?invite=abc',
      webUrl: 'https://t.me/+abc',
    };
    linkUtils.parseTelegramLink.mockReturnValue(link);
    api.resolveInvite.mockResolvedValue({
      status: 'preview',
      preview: { title: 'T', kind: 'group', memberCount: 1, withApproval: false, about: null },
    });
    const { result } = setup();

    act(() => {
      expect(result.current.handleTelegramLink('https://t.me/+abc')).toBe(true);
    });
    expect(api.resolveInvite).toHaveBeenCalledWith({ invite: 'abc' });
  });

  it('launches non-chat Telegram links in the app', () => {
    const link = { chat: null, invite: null, postId: null, commentId: null, deepLink: 'tg://settings', webUrl: null };
    linkUtils.parseTelegramLink.mockReturnValue(link);
    const { result } = setup();

    act(() => {
      expect(result.current.handleTelegramLink('tg://settings')).toBe(true);
    });
    expect(linkUtils.launchTelegramApp).toHaveBeenCalledWith('tg://settings', null);
  });

  it('opens a known chat directly', () => {
    const known = dialog(7);
    const link = { chat: { username: 'known' }, invite: null, postId: 5, commentId: 2, deepLink: 'd', webUrl: 'w' };
    linkUtils.parseTelegramLink.mockReturnValue(link);
    linkUtils.findLinkedChat.mockReturnValue(known.chat);
    const { result, openChat } = setup([known]);

    act(() => {
      expect(result.current.handleTelegramLink('https://t.me/known/5?comment=2')).toBe(true);
    });
    expect(openChat).toHaveBeenCalledWith(known.chat, { postId: 5, commentId: 2 });
    expect(api.resolveChat).not.toHaveBeenCalled();
  });

  it('resolves unknown chats, previews non-members, and hands off 404s', async () => {
    const link = { chat: { username: 'pub' }, invite: null, postId: 9, commentId: null, deepLink: 'd', webUrl: 'w' };
    linkUtils.parseTelegramLink.mockReturnValue(link);
    linkUtils.findLinkedChat.mockReturnValue(null);
    const { result, openChat, registerChat, setPreview, onError } = setup();
    const resolvedChat = chat(10, 'pub');

    api.resolveChat.mockResolvedValueOnce({ chat: resolvedChat, member: true });
    await act(async () => {
      result.current.handleTelegramLink('https://t.me/pub/9');
    });
    await waitFor(() => expect(openChat).toHaveBeenCalledWith(resolvedChat, { postId: 9 }));
    expect(setPreview).toHaveBeenCalledWith(null);

    api.resolveChat.mockResolvedValueOnce({ chat: resolvedChat, member: false });
    await act(async () => {
      result.current.handleTelegramLink('https://t.me/pub/9');
    });
    await waitFor(() => expect(setPreview).toHaveBeenCalledWith(expect.objectContaining({ chatId: 10 })));
    expect(registerChat).toHaveBeenCalledWith(resolvedChat);

    const noUsername = chat(11, null);
    api.resolveChat.mockResolvedValueOnce({ chat: noUsername, member: false });
    await act(async () => {
      result.current.handleTelegramLink('https://t.me/pub/9');
    });
    await waitFor(() => expect(linkUtils.handOffTarget).toHaveBeenCalled());

    api.resolveChat.mockRejectedValueOnce(new TestServiceError(404, 'not_found', 'missing'));
    await act(async () => {
      result.current.handleTelegramLink('https://t.me/pub/9');
    });
    await waitFor(() => expect(linkUtils.handOffTarget).toHaveBeenCalledTimes(2));

    api.resolveChat.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      result.current.handleTelegramLink('https://t.me/pub/9');
    });
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
