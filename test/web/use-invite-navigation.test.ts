import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { ServiceError } from '@rexezuge/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDto } from '../../apps/web/src/types';

const api = vi.hoisted(() => ({
  resolveInvite: vi.fn(),
  joinInvite: vi.fn(),
}));
const links = vi.hoisted(() => ({
  launchTelegramApp: vi.fn(),
}));

vi.mock('../../apps/web/src/api', () => api);
vi.mock('../../apps/web/src/links', () => links);

const { useInviteNavigation } = await import('../../apps/web/src/useInviteNavigation');

function chat(id: number): ChatDto {
  return {
    id,
    kind: 'channel',
    title: 'Announcements',
    username: 'announce',
    photo: null,
    canSendMessages: true,
    canDeleteMessages: true,
    presence: null,
  };
}

const inviteLink = {
  chat: null,
  invite: 'AbCd-123',
  postId: null,
  commentId: null,
  deepLink: 'tg://join?invite=AbCd-123',
  webUrl: 'https://t.me/+AbCd-123',
} as const;

class TestServiceError extends ServiceError {}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('useInviteNavigation', () => {
  it('ignores a link without an invite hash', () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useInviteNavigation({
        resolutionRef: { current: 0 },
        registerChat: vi.fn(),
        openChat: vi.fn(),
        reload: vi.fn(async () => {}),
        onError,
        onNotice: vi.fn(),
      }),
    );

    act(() => result.current.open({ ...inviteLink, invite: null }));
    expect(api.resolveInvite).not.toHaveBeenCalled();
    expect(result.current.invite).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('opens a chat the account is already in', async () => {
    const registerChat = vi.fn();
    const openChat = vi.fn();
    const joinedChat = chat(1);
    api.resolveInvite.mockResolvedValue({ status: 'joined', chat: joinedChat });

    const { result } = renderHook(() =>
      useInviteNavigation({
        resolutionRef: { current: 0 },
        registerChat,
        openChat,
        reload: vi.fn(async () => {}),
        onError: vi.fn(),
        onNotice: vi.fn(),
      }),
    );

    act(() => result.current.open(inviteLink));

    await waitFor(() => expect(openChat).toHaveBeenCalledWith(joinedChat));
    expect(registerChat).toHaveBeenCalledWith(joinedChat);
    expect(result.current.invite).toBeNull();
  });

  it('shows the card for a chat the account is not in', async () => {
    api.resolveInvite.mockResolvedValue({
      status: 'preview',
      preview: { title: 'Announcements', kind: 'channel', memberCount: 12, withApproval: false, about: null },
    });

    const { result } = renderHook(() =>
      useInviteNavigation({
        resolutionRef: { current: 0 },
        registerChat: vi.fn(),
        openChat: vi.fn(),
        reload: vi.fn(async () => {}),
        onError: vi.fn(),
        onNotice: vi.fn(),
      }),
    );

    act(() => result.current.open(inviteLink));

    await waitFor(() => expect(result.current.invite?.preview.title).toBe('Announcements'));
    expect(result.current.invite?.joining).toBe(false);
    expect(result.current.invite?.requested).toBe(false);
  });

  it('drops a stale resolve answer', async () => {
    let resolve!: (value: unknown) => void;
    api.resolveInvite.mockReturnValue(new Promise((r) => (resolve = r)));
    const openChat = vi.fn();

    const resolutionRef = { current: 0 };
    const { result } = renderHook(() =>
      useInviteNavigation({
        resolutionRef,
        registerChat: vi.fn(),
        openChat,
        reload: vi.fn(async () => {}),
        onError: vi.fn(),
        onNotice: vi.fn(),
      }),
    );

    act(() => result.current.open(inviteLink));
    resolutionRef.current += 1;
    await act(async () => {
      resolve({ status: 'preview', preview: { title: 'Late', kind: 'group', memberCount: 1, withApproval: false, about: null } });
    });

    expect(result.current.invite).toBeNull();
    expect(openChat).not.toHaveBeenCalled();
  });

  it('reports dead invite links and other failures', async () => {
    const onNotice = vi.fn();
    const onError = vi.fn();
    const resolutionRef = { current: 0 };
    const initialProps: { failure: unknown } = { failure: new TestServiceError(410, 'invite_expired', 'x') };
    const { result, rerender } = renderHook(
      ({ failure }: { failure: unknown }) => {
        api.resolveInvite.mockReset();
        api.resolveInvite.mockRejectedValue(failure);
        return useInviteNavigation({
          resolutionRef,
          registerChat: vi.fn(),
          openChat: vi.fn(),
          reload: vi.fn(async () => {}),
          onError,
          onNotice,
        });
      },
      { initialProps },
    );

    act(() => result.current.open(inviteLink));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('This Invite Link Has Expired.'));

    rerender({ failure: new TestServiceError(404, 'invite_invalid', 'x') });
    act(() => result.current.open(inviteLink));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('This Invite Link Is Not Valid.'));

    const boom = new Error('boom');
    rerender({ failure: boom });
    act(() => result.current.open(inviteLink));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('joins, opens the chat, and reloads on success', async () => {
    const registerChat = vi.fn();
    const openChat = vi.fn();
    const reload = vi.fn(async () => {});
    const joinedChat = chat(2);
    api.resolveInvite.mockResolvedValue({
      status: 'preview',
      preview: { title: 'Announcements', kind: 'channel', memberCount: 12, withApproval: false, about: null },
    });
    api.joinInvite.mockResolvedValue({ status: 'joined', chat: joinedChat });

    const { result } = renderHook(() =>
      useInviteNavigation({
        resolutionRef: { current: 0 },
        registerChat,
        openChat,
        reload,
        onError: vi.fn(),
        onNotice: vi.fn(),
      }),
    );

    act(() => result.current.open(inviteLink));
    await waitFor(() => expect(result.current.invite).not.toBeNull());

    act(() => result.current.join());
    await waitFor(() => expect(openChat).toHaveBeenCalledWith(joinedChat));
    expect(registerChat).toHaveBeenCalledWith(joinedChat);
    expect(reload).toHaveBeenCalled();
    expect(result.current.invite).toBeNull();
  });

  it('keeps the card for request_sent and hands webview to the app', async () => {
    const onNotice = vi.fn();
    api.resolveInvite.mockResolvedValue({
      status: 'preview',
      preview: { title: 'Announcements', kind: 'channel', memberCount: 12, withApproval: false, about: null },
    });

    const { result } = renderHook(() =>
      useInviteNavigation({
        resolutionRef: { current: 0 },
        registerChat: vi.fn(),
        openChat: vi.fn(),
        reload: vi.fn(async () => {}),
        onError: vi.fn(),
        onNotice,
      }),
    );

    act(() => result.current.open(inviteLink));
    await waitFor(() => expect(result.current.invite).not.toBeNull());

    api.joinInvite.mockResolvedValueOnce({ status: 'request_sent', chat: null });
    act(() => result.current.join());
    await waitFor(() => expect(result.current.invite?.requested).toBe(true));
    expect(onNotice).toHaveBeenCalledWith('Your Join Request Was Sent. An Admin Has To Approve It.');

    api.joinInvite.mockResolvedValueOnce({ status: 'webview', chat: null });
    // reset requested/joining state by re-opening
    act(() => result.current.open(inviteLink));
    await waitFor(() => expect(result.current.invite?.requested).toBe(false));
    act(() => result.current.join());
    await waitFor(() => expect(links.launchTelegramApp).toHaveBeenCalledWith(inviteLink.deepLink, inviteLink.webUrl));
    expect(result.current.invite).toBeNull();
  });

  it('reports join failures and blocks dismiss while joining', async () => {
    const onNotice = vi.fn();
    const onError = vi.fn();
    let reject!: (e: unknown) => void;
    api.resolveInvite.mockResolvedValue({
      status: 'preview',
      preview: { title: 'Announcements', kind: 'channel', memberCount: 12, withApproval: false, about: null },
    });

    const { result } = renderHook(() =>
      useInviteNavigation({
        resolutionRef: { current: 0 },
        registerChat: vi.fn(),
        openChat: vi.fn(),
        reload: vi.fn(async () => {}),
        onError,
        onNotice,
      }),
    );

    act(() => result.current.open(inviteLink));
    await waitFor(() => expect(result.current.invite).not.toBeNull());

    api.joinInvite.mockReturnValue(new Promise((_r, rej) => (reject = rej)));
    act(() => result.current.join());
    await waitFor(() => expect(result.current.invite?.joining).toBe(true));
    act(() => result.current.dismiss());
    expect(result.current.invite).not.toBeNull();

    await act(async () => {
      reject(new TestServiceError(410, 'invite_expired', 'x'));
    });
    await waitFor(() => expect(result.current.invite).toBeNull());
    expect(onNotice).toHaveBeenCalledWith('This Invite Link Has Expired.');

    act(() => result.current.open(inviteLink));
    await waitFor(() => expect(result.current.invite).not.toBeNull());
    api.joinInvite.mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.join());
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
