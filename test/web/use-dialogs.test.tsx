import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DialogDto, UpdateEvent } from '../../apps/web/src/types';

const fetchDialogs = vi.fn<() => Promise<{ dialogs: DialogDto[] }>>();
const fetchArchivedDialogs = vi.fn<() => Promise<{ dialogs: DialogDto[] }>>();
const setArchivedRpc = vi.fn<() => Promise<unknown>>();
const setPinnedRpc = vi.fn<() => Promise<unknown>>();

vi.mock('../../apps/web/src/api', () => ({
  fetchDialogs,
  fetchArchivedDialogs,
  setArchived: setArchivedRpc,
  setPinned: setPinnedRpc,
}));

const { useDialogs } = await import('../../apps/web/src/useDialogs');

function dialog(id: number): DialogDto {
  return {
    chat: {
      id,
      kind: 'user',
      title: `Chat ${String(id)}`,
      username: null,
      photo: null,
      canSendMessages: true,
      canDeleteMessages: true,
      canPinMessages: true,
      presence: null,
    },
    lastMessage: null,
    unread: 0,
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
    archived: false,
  };
}

function deferred(): { promise: Promise<unknown>; settle: (value: unknown) => void; fail: (error: unknown) => void } {
  let settle!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<unknown>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

describe('useDialogs optimistic rollback', () => {
  beforeEach(() => {
    fetchDialogs.mockReset().mockResolvedValue({ dialogs: [dialog(1), dialog(2)] });
    fetchArchivedDialogs.mockReset().mockResolvedValue({ dialogs: [] });
    setArchivedRpc.mockReset();
    setPinnedRpc.mockReset();
  });

  it('undoes an archive move without discarding a live update received meanwhile', async () => {
    const pending = deferred();
    setArchivedRpc.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useDialogs({ onError: vi.fn(), onNotice: vi.fn() }));
    await act(async () => {
      await result.current.load();
    });

    let move!: Promise<void>;
    await act(async () => {
      move = result.current.setArchived(1, true);
    });
    expect(result.current.find(1)?.archived).toBe(true);

    // A pin arrives for a different chat while the bridge call is in flight.
    await act(async () => {
      result.current.applyUpdate({ type: 'pinned', chatId: 2, pinned: true } satisfies UpdateEvent, null);
    });

    await act(async () => {
      pending.fail(new Error('refused'));
      await move;
    });

    expect(result.current.find(1)?.archived).toBe(false);
    expect(result.current.find(2)?.pinned).toBe(true);
  });

  it('undoes a pin without discarding a live update received meanwhile', async () => {
    const pending = deferred();
    setPinnedRpc.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useDialogs({ onError: vi.fn(), onNotice: vi.fn() }));
    await act(async () => {
      await result.current.load();
    });

    let pin!: Promise<void>;
    await act(async () => {
      pin = result.current.setPinned(1, true);
    });
    expect(result.current.find(1)?.pinned).toBe(true);

    await act(async () => {
      result.current.applyUpdate({ type: 'pinned', chatId: 2, pinned: true } satisfies UpdateEvent, null);
    });

    await act(async () => {
      pending.fail(new Error('refused'));
      await pin;
    });

    expect(result.current.find(1)?.pinned).toBe(false);
    expect(result.current.find(2)?.pinned).toBe(true);
  });
});
