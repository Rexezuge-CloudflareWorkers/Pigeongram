import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatDto, MessageDto } from '../../apps/web/src/types';
import { useShellOverlays } from '../../apps/web/src/useShellOverlays';

/**
The shell's overlay state: the search sheet and the new-message picker.

The hook owns only when each is open and what a choice does; the choice
itself belongs to navigation, which is why both callbacks are handed out.
*/

afterEach(cleanup);

const chat: ChatDto = {
  id: 2,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
  canDeleteMessages: true,
  canPinMessages: true,
  presence: null,
};

const message = { chatId: 2, id: 10 } as MessageDto;

function setup() {
  const openSearchResult = vi.fn();
  const openFoundChat = vi.fn();
  const hook = renderHook(() => useShellOverlays({ openSearchResult, openFoundChat }));
  return { openSearchResult, openFoundChat, hook };
}

describe('useShellOverlays', () => {
  it('opens every-chat search, a hashtag search and the open chat’s search', () => {
    const { hook } = setup();

    act(() => hook.result.current.openGlobalSearch());
    expect(hook.result.current.search).toEqual({ scope: { kind: 'all' } });

    act(() => hook.result.current.searchHashtag('tag'));
    expect(hook.result.current.search).toEqual({ scope: { kind: 'all' }, query: 'tag' });

    act(() => hook.result.current.openThreadSearch(chat));
    expect(hook.result.current.search).toEqual({ scope: { kind: 'chat', chatId: 2 } });

    // No open chat is not an error: the sheet simply does not open.
    act(() => hook.result.current.openThreadSearch(null));
    expect(hook.result.current.search).toEqual({ scope: { kind: 'chat', chatId: 2 } });

    act(() => hook.result.current.closeSearch());
    expect(hook.result.current.search).toBeNull();
  });

  it('closes the search sheet before opening the chosen hit', () => {
    const { hook, openSearchResult } = setup();

    act(() => hook.result.current.openGlobalSearch());
    act(() => hook.result.current.openSearchResult(message, chat));

    expect(hook.result.current.search).toBeNull();
    expect(openSearchResult).toHaveBeenCalledWith(chat, message);
  });

  it('closes the new-message picker before opening the chosen chat', () => {
    const { hook, openFoundChat } = setup();

    act(() => hook.result.current.openNewChat());
    expect(hook.result.current.newChat).toBe(true);

    act(() => hook.result.current.selectNewChat(chat));
    expect(hook.result.current.newChat).toBe(false);
    expect(openFoundChat).toHaveBeenCalledWith(chat);

    act(() => hook.result.current.openNewChat());
    act(() => hook.result.current.closeNewChat());
    expect(hook.result.current.newChat).toBe(false);
  });
});
