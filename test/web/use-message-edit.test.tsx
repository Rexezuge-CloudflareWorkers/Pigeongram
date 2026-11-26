import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageDto } from '../../apps/web/src/types';

const editMessage = vi.fn<() => Promise<{ message: MessageDto }>>();

vi.mock('../../apps/web/src/api', () => ({ editMessage }));

const { useMessageEdit } = await import('../../apps/web/src/useMessageEdit');

function message(text = 'before', id = 1): MessageDto {
  return {
    id,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: true,
    date: 1_700_000_000_000,
    pinned: false,
    editDate: null,
    text,
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
  };
}

function mount() {
  const setThread = vi.fn();
  const onEdited = vi.fn();
  const onError = vi.fn();
  const onScheduledEdited = vi.fn();
  const hook = renderHook(() => useMessageEdit({ setThread, onEdited, onScheduledEdited, onError }));
  return { ...hook, setThread, onEdited, onScheduledEdited, onError };
}

describe('useMessageEdit', () => {
  beforeEach(() => {
    editMessage.mockReset();
  });

  it('opens, cancels and resets the editor', () => {
    const { result } = mount();
    act(() => result.current.startEdit(message()));
    expect(result.current.editing?.text).toBe('before');
    act(() => result.current.cancelEdit());
    expect(result.current.editing).toBeNull();
    act(() => result.current.startEdit(message()));
    act(() => result.current.reset());
    expect(result.current.editing).toBeNull();
  });

  it('closes blank and unchanged edits without a round trip', async () => {
    const { result } = mount();
    act(() => result.current.startEdit(message()));

    await act(async () => {
      await result.current.saveEdit(' '.repeat(3));
    });
    expect(editMessage).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();

    act(() => result.current.startEdit(message('  before  ')));
    await act(async () => {
      await result.current.saveEdit('before');
    });
    expect(editMessage).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
  });

  it('folds the server copy into the thread and the chat list', async () => {
    const saved = message('after');
    editMessage.mockResolvedValue({ message: saved });
    const { result, setThread, onEdited } = mount();
    act(() => result.current.startEdit(message()));

    await act(async () => {
      await result.current.saveEdit('after');
    });

    expect(editMessage).toHaveBeenCalledWith(2, 1, 'after');
    expect(setThread).toHaveBeenCalled();
    expect(onEdited).toHaveBeenCalledWith(saved);
    expect(result.current.editing).toBeNull();
  });

  it('keeps the editor open and reports a refusal', async () => {
    const failure = new Error('not allowed');
    editMessage.mockRejectedValue(failure);
    const { result, onError } = mount();
    act(() => result.current.startEdit(message()));

    await act(async () => {
      await result.current.saveEdit('after');
    });

    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.editing?.text).toBe('before');
  });

  it('refreshes the editor from a live edit and forgets a deleted target', () => {
    const { result } = mount();
    act(() => result.current.startEdit(message()));

    act(() => result.current.refresh(message('from another device')));
    expect(result.current.editing?.text).toBe('from another device');

    act(() => result.current.refresh(message('other', 99)));
    expect(result.current.editing?.text).toBe('from another device');

    act(() => result.current.forget(3, [1]));
    expect(result.current.editing?.text).toBe('from another device');

    act(() => result.current.forget(2, [1]));
    expect(result.current.editing).toBeNull();
  });

  it('does nothing when nothing is being edited', async () => {
    const { result } = mount();
    await expect(result.current.saveEdit('after')).resolves.toBeUndefined();
    expect(editMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.editing).toBeNull());
  });
});
