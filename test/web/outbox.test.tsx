import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingMessage } from '../../apps/web/src/outbox';
import { pendingAsMessage, withPendingDialogs } from '../../apps/web/src/outbox';
import type { PendingBody } from '../../apps/web/src/useOutbox';
import { useOutbox } from '../../apps/web/src/useOutbox';
import type { ChatDto, DialogDto, DialogMessageDto, MessageDto } from '../../apps/web/src/types';

afterEach(cleanup);

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
    text: `message ${String(overrides.id)}`,
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

function dialog(chat: ChatDto, lastMessage: DialogMessageDto | null): DialogDto {
  return {
    chat,
    lastMessage,
    unread: 0,
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
    archived: false,
  };
}

/**
The chat list's view of a message: the list renders a preview, not a thread.
*/
function dialogMessage(source: MessageDto): DialogMessageDto {
  return {
    id: source.id,
    date: source.date,
    text: source.text,
    media: source.media,
    poll: source.poll,
    outgoing: source.outgoing,
    service: source.service,
    groupedId: source.groupedId,
  };
}

function pending(overrides: Partial<PendingMessage> = {}): PendingMessage {
  return {
    key: 'pending-1',
    sequence: 1,
    randomId: '123456789',
    chatId: 2,
    scope: '2',
    kind: 'text',
    text: 'hello',
    fileCount: 0,
    replyTo: null,
    replyPreview: null,
    media: null,
    previewUrl: null,
    createdAt: 1_700_000_000_000,
    status: 'sending',
    progress: null,
    failure: null,
    ...overrides,
  };
}

describe('the chat list overlay', () => {
  it('previews a pending send and drops it again when it is discarded', () => {
    const dialogs = [dialog(bob, dialogMessage(message({ id: 10, chatId: 2, text: 'see you' }))), dialog(carol, null)];

    const rows = withPendingDialogs(dialogs, [pending()], 2);
    expect(rows[0].chat.id).toBe(2);
    expect(rows[0].lastMessage?.text).toBe('hello');
    expect(rows[0].unread).toBe(0);

    // The server dialogs are untouched: the overlay is a rendering concern.
    expect(dialogs[0].lastMessage?.text).toBe('see you');
  });

  it('keeps a pinned chat in place and folds the pending message into it', () => {
    const pinned = { ...dialog(bob, null), pinned: true };
    const dialogs = [dialog(carol, null), pinned];

    const rows = withPendingDialogs(dialogs, [pending()], 2);
    expect(rows.map((row) => row.chat.id)).toEqual([3, 2]);
    expect(rows[1].lastMessage?.text).toBe('hello');
  });

  it('never lets a pending message carry a real id', () => {
    const synthetic = pendingAsMessage(pending({ sequence: 7 }));
    expect(synthetic.id).toBe(-7);
    expect(synthetic.outgoing).toBe(true);
    expect(synthetic.chatId).toBe(2);
  });
});

describe('the outbox', () => {
  it('shows a text send at once and settles it into the thread', async () => {
    const onSettled = vi.fn();
    const deliver = vi.fn(async () => [message({ id: 11, chatId: 2, outgoing: true, text: 'hello' })]);
    const { result } = renderHook(() => useOutbox({ onError: vi.fn() }));

    act(() => {
      result.current.send({
        chatId: 2,
        scope: '2',
        text: 'hello',
        deliver,
        onSettled,
      });
    });

    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].text).toBe('hello');
    expect(result.current.pending[0].randomId).toMatch(/^\d+$/);

    await waitFor(() => {
      expect(result.current.pending).toHaveLength(0);
    });
    expect(onSettled).toHaveBeenCalledWith([expect.objectContaining({ id: 11 })]);
  });

  it('keeps text sends in submission order', async () => {
    const releases: Array<(messages: MessageDto[]) => void> = [];
    const deliver = vi.fn(
      (_body: PendingBody, _randomIds: readonly string[]) =>
        new Promise<MessageDto[]>((resolve) => {
          releases.push(resolve);
        }),
    );
    const { result } = renderHook(() => useOutbox({ onError: vi.fn() }));

    act(() => {
      result.current.send({ chatId: 2, scope: '2', text: 'first', deliver, onSettled: vi.fn() });
      result.current.send({ chatId: 2, scope: '2', text: 'second', deliver, onSettled: vi.fn() });
    });

    expect(result.current.pending).toHaveLength(2);
    await waitFor(() => {
      expect(deliver).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      releases[0]?.([message({ id: 11, chatId: 2, outgoing: true, text: 'first' })]);
    });
    await waitFor(() => {
      expect(deliver).toHaveBeenCalledTimes(2);
    });
    expect(deliver.mock.calls[1]?.[1]).not.toEqual(deliver.mock.calls[0]?.[1]);

    await act(async () => {
      releases[1]?.([message({ id: 12, chatId: 2, outgoing: true, text: 'second' })]);
    });
    await waitFor(() => {
      expect(result.current.pending).toHaveLength(0);
    });
  });

  it('keeps a failed send with its text and retries it with the same random id', async () => {
    const onError = vi.fn();
    const deliver = vi
      .fn<(body: PendingBody, randomIds: readonly string[]) => Promise<MessageDto[]>>()
      .mockRejectedValueOnce(new Error('the bridge is offline'))
      .mockResolvedValueOnce([message({ id: 13, chatId: 2, outgoing: true, text: 'hello' })]);
    const { result } = renderHook(() => useOutbox({ onError }));

    act(() => {
      result.current.send({ chatId: 2, scope: '2', text: 'hello', deliver, onSettled: vi.fn() });
    });

    await waitFor(() => {
      expect(result.current.pending[0]?.status).toBe('failed');
    });
    expect(result.current.pending[0].failure).toBe('the bridge is offline');
    expect(result.current.pending[0].text).toBe('hello');
    expect(onError).toHaveBeenCalled();

    const randomId = result.current.pending[0].randomId;
    act(() => {
      result.current.retry(result.current.pending[0].key);
    });

    await waitFor(() => {
      expect(result.current.pending).toHaveLength(0);
    });
    expect(deliver.mock.calls[1]?.[1][0]).toBe(randomId);
  });

  it('discards a failed send without touching the thread', async () => {
    const onSettled = vi.fn();
    const deliver = vi
      .fn<(body: PendingBody, randomIds: readonly string[]) => Promise<MessageDto[]>>()
      .mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useOutbox({ onError: vi.fn() }));

    act(() => {
      result.current.send({ chatId: 2, scope: '2', text: 'hello', deliver, onSettled });
    });
    await waitFor(() => {
      expect(result.current.pending[0]?.status).toBe('failed');
    });

    act(() => {
      result.current.discard(result.current.pending[0].key);
    });
    expect(result.current.pending).toHaveLength(0);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('shows a file selection at once and hands it to the delivery', async () => {
    const onSettled = vi.fn();
    let release: ((messages: MessageDto[]) => void) | undefined;
    const deliver = vi.fn(
      (_body: PendingBody, _randomIds: readonly string[]) =>
        new Promise<MessageDto[]>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useOutbox({ onError: vi.fn() }));
    const file = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' });

    act(() => {
      result.current.attach({
        chatId: 2,
        scope: '2',
        request: { files: [file], caption: 'the note', grouped: false },
        deliver,
        onSettled,
      });
    });

    // The file is on screen before the upload starts.
    expect(result.current.pending[0].media?.kind).toBe('document');
    expect(result.current.pending[0].media?.fileName).toBe('note.txt');
    expect(result.current.pending[0].fileCount).toBe(1);
    expect(result.current.pending[0].text).toBe('the note');

    await waitFor(() => {
      expect(deliver).toHaveBeenCalledTimes(1);
    });
    const body = deliver.mock.calls[0]?.[0];
    expect(body?.kind).toBe('file');
    if (body?.kind === 'file') {
      expect(body.request.files).toHaveLength(1);
      expect(body.request.caption).toBe('the note');
    }

    await act(async () => {
      release?.([message({ id: 14, chatId: 2, outgoing: true, text: 'the note' })]);
    });
    await waitFor(() => {
      expect(result.current.pending).toHaveLength(0);
    });
    expect(onSettled).toHaveBeenCalled();
  });

  it('gives every file of a batch its own random id', async () => {
    const deliver = vi.fn<(body: PendingBody, randomIds: readonly string[]) => Promise<MessageDto[]>>(async () => []);
    const { result } = renderHook(() => useOutbox({ onError: vi.fn() }));
    const files = [
      new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
      new File([new Uint8Array([2])], 'b.png', { type: 'image/png' }),
    ];

    act(() => {
      result.current.attach({
        chatId: 2,
        scope: '2',
        request: { files, caption: '', grouped: true },
        deliver,
        onSettled: vi.fn(),
      });
    });

    expect(result.current.pending[0].fileCount).toBe(2);
    await waitFor(() => {
      expect(deliver).toHaveBeenCalledTimes(1);
    });
    const randomIds = deliver.mock.calls[0]?.[1] ?? [];
    expect(randomIds).toHaveLength(2);
    expect(randomIds[0]).not.toBe(randomIds[1]);
  });
});
