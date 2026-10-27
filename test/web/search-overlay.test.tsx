import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatDto, MessageDto } from '../../apps/web/src/types';

/**
 * The bridge calls the overlay makes, replaced so the test drives the answers.
 * `vi.hoisted` keeps them available to the module factory, which Vitest lifts
 * above the imports.
 */
const bridge = vi.hoisted(() => ({ searchGlobal: vi.fn(), searchMessages: vi.fn() }));

vi.mock('../../apps/web/src/api', () => bridge);

const { SearchOverlay } = await import('../../apps/web/src/components/SearchOverlay');

afterEach(() => {
  cleanup();
  bridge.searchGlobal.mockReset();
  bridge.searchMessages.mockReset();
});

const bob: ChatDto = { id: 2, kind: 'user', title: 'Bob', username: 'bob', photo: null, canSendMessages: true, presence: null };
const carol: ChatDto = { id: 3, kind: 'user', title: 'Carol', username: 'carol', photo: null, canSendMessages: true, presence: null };

function message(overrides: Partial<MessageDto> & { id: number; chatId: number }): MessageDto {
  return {
    groupedId: null,
    senderId: null,
    senderName: null,
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text: 'a message',
    entities: [],
    reactions: [],
    service: false,
    media: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
    ...overrides,
  };
}

describe('SearchOverlay', () => {
  it('searches every chat, marks the query and opens a result with its chat', async () => {
    const hit = message({ id: 10, chatId: 3, senderName: 'Carol', text: 'the tag is here' });
    bridge.searchGlobal.mockResolvedValue({ messages: [hit], chats: [carol] });
    const onOpenResult = vi.fn();

    render(<SearchOverlay chat={null} initialScope={{ kind: 'all' }} onOpenResult={onOpenResult} onClose={() => {}} />);

    const input = screen.getByRole('searchbox', { name: 'Search messages' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'tag' } });

    expect(await screen.findByText('Carol')).toBeDefined();
    expect(screen.getByText('tag').tagName).toBe('MARK');
    await waitFor(() => expect(bridge.searchGlobal).toHaveBeenCalledWith('tag', { limit: 50 }));

    fireEvent.click(screen.getByRole('button', { name: /Carol/ }));

    expect(onOpenResult).toHaveBeenCalledWith(hit, carol);
  });

  it('starts in the open chat and switches to every chat', async () => {
    const hit = message({ id: 9, chatId: 2, senderName: 'Bob', text: 'chat only' });
    bridge.searchMessages.mockResolvedValue({ messages: [hit] });
    bridge.searchGlobal.mockResolvedValue({ messages: [], chats: [] });

    render(<SearchOverlay chat={bob} initialScope={{ kind: 'chat', chatId: 2 }} onOpenResult={() => {}} onClose={() => {}} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search messages' }), { target: { value: 'chat' } });

    expect(await screen.findByText('Bob')).toBeDefined();
    await waitFor(() => expect(bridge.searchMessages).toHaveBeenCalledWith(2, 'chat', { limit: 50 }));

    fireEvent.click(screen.getByRole('button', { name: 'All chats' }));

    await waitFor(() => expect(bridge.searchGlobal).toHaveBeenCalledWith('chat', { limit: 50 }));
    expect(screen.getByRole('button', { name: 'All chats' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('pages with the cursor the previous page returned', async () => {
    const first = message({ id: 10, chatId: 2, text: 'first page' });
    const second = message({ id: 4, chatId: 2, text: 'second page' });
    bridge.searchGlobal.mockResolvedValueOnce({ messages: [first], chats: [bob], next: { rate: 1, chatId: 2, messageId: 10 } });
    bridge.searchGlobal.mockResolvedValueOnce({ messages: [second], chats: [bob] });

    render(<SearchOverlay chat={null} initialScope={{ kind: 'all' }} onOpenResult={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search messages' }), { target: { value: 'page' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Load more results' }));

    expect(await screen.findByRole('button', { name: /second page/ })).toBeDefined();
    expect(bridge.searchGlobal).toHaveBeenLastCalledWith('page', {
      limit: 50,
      offset: { rate: 1, chatId: 2, messageId: 10 },
    });
    expect(screen.queryByRole('button', { name: 'Load more results' })).toBeNull();
  });

  it('clears the results when the query is emptied', async () => {
    const hit = message({ id: 7, chatId: 2, text: 'found it' });
    bridge.searchGlobal.mockResolvedValue({ messages: [hit], chats: [bob] });

    render(<SearchOverlay chat={null} initialScope={{ kind: 'all' }} onOpenResult={() => {}} onClose={() => {}} />);
    const input = screen.getByRole('searchbox', { name: 'Search messages' });
    fireEvent.change(input, { target: { value: 'found' } });
    expect(await screen.findByRole('button', { name: /found it/ })).toBeDefined();

    fireEvent.change(input, { target: { value: ' '.repeat(3) } });

    expect(screen.queryByRole('button', { name: /found it/ })).toBeNull();
    expect(screen.getByText('Type to search all chats.')).toBeDefined();
  });

  it('reports a failed search instead of an empty one', async () => {
    bridge.searchGlobal.mockRejectedValue(new Error('Search is down'));

    render(<SearchOverlay chat={null} initialScope={{ kind: 'all' }} onOpenResult={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search messages' }), { target: { value: 'boom' } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Search is down');
    expect(screen.queryByText('No messages found for “boom”.')).toBeNull();
  });

  it('closes on Escape and returns the focus to the opener', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open search';
    // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<SearchOverlay chat={null} initialScope={{ kind: 'all' }} onOpenResult={() => {}} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
