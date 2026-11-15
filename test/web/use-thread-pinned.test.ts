import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPinnedMessages, setMessagePinned } from '../../apps/web/src/api';
import type { ChatThread } from '../../apps/web/src/thread-state';
import type { ChatDto, MessageDto } from '../../apps/web/src/types';
import { useThreadPinned } from '../../apps/web/src/useThreadPinned';

vi.mock('../../apps/web/src/api', () => ({
  fetchPinnedMessages: vi.fn(),
  setMessagePinned: vi.fn(),
}));

const pinnedRead = vi.mocked(fetchPinnedMessages);
const pinnedWrite = vi.mocked(setMessagePinned);

const CHAT: ChatDto = {
  id: 1,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
  canDeleteMessages: true,
  canPinMessages: true,
  presence: null,
};

function message(id: number, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id,
    chatId: 1,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000 + id,
    pinned: false,
    editDate: null,
    text: `message ${id}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: null,
    markup: null,
    replyKeyboard: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
    ...overrides,
  };
}

function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    chat: CHAT,
    messages: [message(1), message(2), message(3)],
    readInboxMaxId: 3,
    readOutboxMaxId: 0,
    unreadDividerId: null,
    focusMessageId: null,
    hasMoreOlder: false,
    windowEndId: 3,
    latestMessageId: 3,
    newMessageIds: new Set(),
    pinnedMessage: null,
    ...overrides,
  };
}

/**
The hook writes through the caller's `setThread`; a mutable holder stands in for
React's state so a test can read what the fold produced.
*/
function harness(initial: ChatThread | null = thread()) {
  let current = initial;
  const setThread = vi.fn((update: ChatThread | null | ((previous: ChatThread | null) => ChatThread | null)) => {
    current = typeof update === 'function' ? update(current) : update;
  });
  const onError = vi.fn();
  const hook = renderHook(() => useThreadPinned({ setThread, threadRef: { current }, onError }));
  return {
    ...hook,
    onError,
    setThread,
    get thread() {
      return current;
    },
  };
}

beforeEach(() => {
  pinnedRead.mockReset();
  pinnedRead.mockResolvedValue({ messages: [] });
  pinnedWrite.mockReset();
});

describe('useThreadPinned', () => {
  it('folds a matching live pin and re-reads the banner body', async () => {
    const banner = message(3);
    pinnedRead.mockResolvedValue({ messages: [banner] });
    const model = harness();

    act(() => model.result.current.fold({ type: 'message_pinned', chatId: 1, messageIds: [2], pinned: true }));

    expect(model.result.current.revision).toBe(1);
    expect(model.thread?.messages.find((entry) => entry.id === 2)?.pinned).toBe(true);
    expect(pinnedRead).toHaveBeenCalledWith(1, { limit: 1 });
    await waitFor(() => expect(model.thread?.pinnedMessage?.id).toBe(3));
  });

  it('clears the banner when the live unpin names it', () => {
    pinnedRead.mockResolvedValue({ messages: [] });
    const model = harness(thread({ pinnedMessage: message(2) }));

    act(() => model.result.current.fold({ type: 'message_pinned', chatId: 1, messageIds: [2], pinned: false }));

    expect(model.thread?.pinnedMessage).toBeNull();
    expect(model.thread?.messages.find((entry) => entry.id === 2)?.pinned).toBe(false);
  });

  it('ignores another chat’s pin', () => {
    const model = harness();

    act(() => model.result.current.fold({ type: 'message_pinned', chatId: 2, messageIds: [2], pinned: true }));

    expect(model.result.current.revision).toBe(0);
    expect(pinnedRead).not.toHaveBeenCalled();
    expect(model.setThread).not.toHaveBeenCalled();
  });

  it('folds an account-level pin only when it names a loaded id', () => {
    const model = harness();

    act(() => model.result.current.fold({ type: 'message_pinned', chatId: null, messageIds: [99], pinned: true }));
    expect(model.result.current.revision).toBe(0);

    act(() => model.result.current.fold({ type: 'message_pinned', chatId: null, messageIds: [2], pinned: true }));
    expect(model.result.current.revision).toBe(1);
    expect(pinnedRead).toHaveBeenCalledWith(1, { limit: 1 });
  });

  it('pins through the engine and folds the answer', async () => {
    pinnedRead.mockResolvedValue({ messages: [message(2, { pinned: true })] });
    pinnedWrite.mockResolvedValue({ chatId: 1, messageId: 2, pinned: true });
    const model = harness();

    act(() => model.result.current.setPinned(message(2), true));
    await waitFor(() => expect(model.thread?.pinnedMessage?.id).toBe(2));

    expect(pinnedWrite).toHaveBeenCalledWith(1, 2, true);
    expect(model.thread?.messages.find((entry) => entry.id === 2)?.pinned).toBe(true);
    expect(model.result.current.revision).toBe(1);
  });

  it('reports a refused pin instead of guessing', async () => {
    pinnedWrite.mockRejectedValue(new Error('Not Allowed'));
    const model = harness();

    act(() => model.result.current.setPinned(message(2), true));
    await waitFor(() => expect(model.onError).toHaveBeenCalledTimes(1));

    expect(model.thread?.messages.find((entry) => entry.id === 2)?.pinned).toBe(false);
    expect(model.result.current.revision).toBe(0);
  });
});
