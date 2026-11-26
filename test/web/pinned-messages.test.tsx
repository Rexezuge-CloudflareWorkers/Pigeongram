import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPinnedMessages } from '../../apps/web/src/api';
import { PinnedBanner } from '../../apps/web/src/components/PinnedBanner';
import { PinnedMessagesDialog } from '../../apps/web/src/components/PinnedMessagesDialog';
import type { PinnedMessagesController } from '../../apps/web/src/usePinnedMessages';
import { usePinnedMessages } from '../../apps/web/src/usePinnedMessages';
import type { ChatDto, MessageDto } from '../../apps/web/src/types';

vi.mock('../../apps/web/src/api', () => ({ fetchPinnedMessages: vi.fn() }));

const pinnedRead = vi.mocked(fetchPinnedMessages);

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
    pinned: true,
    editDate: null,
    text: `pinned ${id}`,
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

function controller(overrides: Partial<PinnedMessagesController> = {}): PinnedMessagesController {
  return {
    isOpen: true,
    messages: [message(9), message(7)],
    loading: false,
    loadingOlder: false,
    error: null,
    hasMore: false,
    openList: vi.fn(),
    close: vi.fn(),
    loadOlder: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  pinnedRead.mockReset();
});

afterEach(cleanup);

describe('PinnedBanner', () => {
  it('names the sender and the message and opens the list', () => {
    const onOpen = vi.fn();
    render(<PinnedBanner chat={CHAT} message={message(9, { text: 'Launch is Friday' })} onOpen={onOpen} />);

    expect(screen.getByText('Pinned Message')).not.toBeNull();
    const bar = screen.getByRole('button', { name: 'Pinned messages' });
    expect(bar.textContent).toContain('Bob');
    expect(bar.textContent).toContain('Launch is Friday');

    fireEvent.click(bar);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('labels the account’s own message as You', () => {
    render(<PinnedBanner chat={CHAT} message={message(9, { outgoing: true })} onOpen={vi.fn()} />);
    expect(screen.getByText('You')).not.toBeNull();
  });

  it('names the chat when an incoming pin carries no sender', () => {
    render(<PinnedBanner chat={CHAT} message={message(9, { senderName: null })} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pinned messages' }).textContent).toContain('Bob');
  });
});

describe('PinnedMessagesDialog', () => {
  it('lists the pins and jumps to the row that was tapped', () => {
    const onOpenPost = vi.fn();
    const model = controller();
    render(<PinnedMessagesDialog chat={CHAT} controller={model} onOpenPost={onOpenPost} />);

    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('pinned 9')).not.toBeNull();
    expect(screen.getByText('pinned 7')).not.toBeNull();

    fireEvent.click(screen.getByText('pinned 7'));
    expect(model.close).toHaveBeenCalledTimes(1);
    expect(onOpenPost).toHaveBeenCalledWith(7);
  });

  it('shows the empty state and offers the older page only when one exists', () => {
    const empty = controller({ messages: [] });
    const { rerender } = render(<PinnedMessagesDialog chat={CHAT} controller={empty} onOpenPost={vi.fn()} />);
    expect(screen.getByText('No Pinned Messages.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Load Older Pinned Messages' })).toBeNull();

    const paged = controller({ hasMore: true });
    rerender(<PinnedMessagesDialog chat={CHAT} controller={paged} onOpenPost={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load Older Pinned Messages' }));
    expect(paged.loadOlder).toHaveBeenCalledTimes(1);
  });

  it('shows the loading spinner on a read in flight and an error beside a loaded page', () => {
    const busy = controller({ messages: [], loading: true });
    const { rerender } = render(<PinnedMessagesDialog chat={CHAT} controller={busy} onOpenPost={vi.fn()} />);
    expect(screen.getByText('Loading Pinned Messages…')).not.toBeNull();

    const failedFirst = controller({ messages: [], error: 'The Pinned Messages Could Not Be Read' });
    rerender(<PinnedMessagesDialog chat={CHAT} controller={failedFirst} onOpenPost={vi.fn()} />);
    expect(screen.getByText('The Pinned Messages Could Not Be Read')).not.toBeNull();
    expect(screen.queryByText('No Pinned Messages.')).toBeNull();

    const failedOlder = controller({ hasMore: true, error: 'The Older Page Could Not Be Read' });
    rerender(<PinnedMessagesDialog chat={CHAT} controller={failedOlder} onOpenPost={vi.fn()} />);
    expect(screen.getByText('The Older Page Could Not Be Read')).not.toBeNull();
    expect(screen.getByText('pinned 9')).not.toBeNull();
  });

  it('renders nothing while closed', () => {
    render(<PinnedMessagesDialog chat={CHAT} controller={controller({ isOpen: false })} onOpenPost={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('usePinnedMessages', () => {
  it('reads the first page on open and appends the older one', async () => {
    pinnedRead
      .mockResolvedValueOnce({ messages: [message(9), message(7)], nextOffsetId: 7 })
      .mockResolvedValueOnce({ messages: [message(5)] });
    const { result } = renderHook(() => usePinnedMessages({ chatId: 1, revision: 0, enabled: true }));

    act(() => result.current.openList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(pinnedRead).toHaveBeenNthCalledWith(1, 1, { limit: 50 });
    expect(result.current.messages.map((entry) => entry.id)).toEqual([9, 7]);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.loadingOlder).toBe(false));

    expect(pinnedRead).toHaveBeenNthCalledWith(2, 1, { limit: 50, offsetId: 7 });
    expect(result.current.messages.map((entry) => entry.id)).toEqual([9, 7, 5]);
    expect(result.current.hasMore).toBe(false);
  });

  it('re-reads the first page when the thread reports another device’s pin', async () => {
    pinnedRead.mockResolvedValueOnce({ messages: [message(9)] }).mockResolvedValueOnce({ messages: [message(12), message(9)] });
    const { result, rerender } = renderHook(({ revision }) => usePinnedMessages({ chatId: 1, revision, enabled: true }), {
      initialProps: { revision: 0 },
    });

    act(() => result.current.openList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ revision: 1 });
    await waitFor(() => expect(result.current.messages.map((entry) => entry.id)).toEqual([12, 9]));
  });

  it('resets and closes when the open chat changes', async () => {
    pinnedRead.mockResolvedValue({ messages: [message(9)] });
    const { result, rerender } = renderHook(({ chatId }) => usePinnedMessages({ chatId, revision: 0, enabled: true }), {
      initialProps: { chatId: 1 as number | null },
    });

    act(() => result.current.openList());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    rerender({ chatId: 2 });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.messages).toEqual([]);
  });

  it('does not open without a chat and stays closed on close', async () => {
    const closed = renderHook(() => usePinnedMessages({ chatId: null, revision: 0, enabled: true }));
    act(() => closed.result.current.openList());
    expect(closed.result.current.isOpen).toBe(false);
    expect(pinnedRead).not.toHaveBeenCalled();

    pinnedRead.mockResolvedValue({ messages: [message(9)] });
    const { result } = renderHook(() => usePinnedMessages({ chatId: 1, revision: 0, enabled: true }));
    act(() => result.current.openList());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  it('re-reads only while the list is open, and reports a failed older page', async () => {
    pinnedRead.mockResolvedValueOnce({ messages: [message(9)], nextOffsetId: 9 });
    const { result, rerender } = renderHook(({ revision }) => usePinnedMessages({ chatId: 1, revision, enabled: true }), {
      initialProps: { revision: 0 },
    });

    rerender({ revision: 1 });
    expect(pinnedRead).not.toHaveBeenCalled();

    act(() => result.current.openList());
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    pinnedRead.mockRejectedValueOnce(new Error('The Older Page Could Not Be Read'));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.error).toBe('The Older Page Could Not Be Read'));
    expect(result.current.messages.map((entry) => entry.id)).toEqual([9]);
    expect(result.current.loadingOlder).toBe(false);
  });

  it('ignores a duplicate when the older page overlaps the loaded one', async () => {
    pinnedRead
      .mockResolvedValueOnce({ messages: [message(9), message(7)], nextOffsetId: 7 })
      .mockResolvedValueOnce({ messages: [message(7), message(5)] });
    const { result } = renderHook(() => usePinnedMessages({ chatId: 1, revision: 0, enabled: true }));

    act(() => result.current.openList());
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.messages.map((entry) => entry.id)).toEqual([9, 7, 5]));
  });

  it('surfaces a failed read instead of pretending the chat has no pins', async () => {
    pinnedRead.mockRejectedValueOnce(new Error('The Pinned Messages Could Not Be Read'));
    const { result } = renderHook(() => usePinnedMessages({ chatId: 1, revision: 0, enabled: true }));

    act(() => result.current.openList());
    await waitFor(() => expect(result.current.error).toBe('The Pinned Messages Could Not Be Read'));
    expect(result.current.messages).toEqual([]);
  });

  it('reads nothing and stays closed while pinned loads are off', async () => {
    pinnedRead.mockResolvedValue({ messages: [message(9)] });
    const { result, rerender } = renderHook(({ enabled }) => usePinnedMessages({ chatId: 1, revision: 0, enabled }), {
      initialProps: { enabled: false },
    });

    act(() => result.current.openList());
    rerender({ enabled: true });
    act(() => result.current.openList());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    rerender({ enabled: false });
    expect(result.current.isOpen).toBe(false);
    expect(pinnedRead).toHaveBeenCalledTimes(1);
  });

  it('refreshes a hidden list when pinned loads come back on', async () => {
    pinnedRead.mockResolvedValue({ messages: [message(9)] });
    const { result, rerender } = renderHook(({ enabled }) => usePinnedMessages({ chatId: 1, revision: 0, enabled }), {
      initialProps: { enabled: true },
    });

    act(() => result.current.openList());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    rerender({ enabled: false });
    expect(result.current.isOpen).toBe(false);

    pinnedRead.mockResolvedValue({ messages: [message(12)] });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.messages.map((entry) => entry.id)).toEqual([12]));
    expect(result.current.isOpen).toBe(true);
    expect(pinnedRead).toHaveBeenCalledTimes(2);
  });

  it('ignores a pin revision while pinned loads are off', async () => {
    pinnedRead.mockResolvedValue({ messages: [message(9)] });
    const { result, rerender } = renderHook(({ revision, enabled }) => usePinnedMessages({ chatId: 1, revision, enabled }), {
      initialProps: { revision: 0, enabled: false },
    });

    rerender({ revision: 1, enabled: false });
    expect(pinnedRead).not.toHaveBeenCalled();
    act(() => result.current.openList());
    expect(pinnedRead).not.toHaveBeenCalled();
  });
});
