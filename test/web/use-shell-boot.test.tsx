import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fetchBootstrap = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/src/api')>();
  return { ...actual, fetchBootstrap };
});

import { useShellBoot } from '../../apps/web/src/useShellBoot';
import type { Route } from '../../apps/web/src/routes';
import type { DialogDto, MeDto } from '../../apps/web/src/types';

const ME: MeDto = { id: 1, firstName: 'Me', lastName: null, username: null, phone: null, photo: null };
const DIALOG = { chat: { id: 2 }, archived: true } as DialogDto;
const CHAT_ROUTE: Route = { view: 'chat', chatId: 2, postId: null };

function options(overrides: Partial<Parameters<typeof useShellBoot>[0]> = {}): Parameters<typeof useShellBoot>[0] {
  return {
    initialMe: ME,
    setMe: vi.fn(),
    hydrateDialogs: vi.fn(async () => {}),
    applyDialogs: vi.fn(),
    loadDialogs: vi.fn(async () => {}),
    loadArchive: vi.fn(async () => {}),
    canOpen: vi.fn(() => true),
    findDialog: vi.fn(() => DIALOG),
    bootRouter: vi.fn(),
    currentRoute: vi.fn(() => CHAT_ROUTE),
    prepareInitialRoute: vi.fn(async () => {}),
    replaceTo: vi.fn(),
    onArchiveContext: vi.fn(),
    ...overrides,
  };
}

describe('useShellBoot', () => {
  it('falls back to the single list read when the combined boot fails', async () => {
    fetchBootstrap.mockRejectedValueOnce(new Error('offline'));
    const opts = options({ canOpen: vi.fn(() => false) });
    renderHook(() => useShellBoot(opts));

    await vi.waitFor(() => expect(opts.loadDialogs).toHaveBeenCalledOnce());
    expect(opts.bootRouter).toHaveBeenCalledOnce();
  });

  it('resolves an archived chat after the boot settles', async () => {
    fetchBootstrap.mockResolvedValueOnce({ me: ME, dialogs: [DIALOG] });
    const canOpen = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const opts = options({ canOpen });
    renderHook(() => useShellBoot(opts));

    await vi.waitFor(() => expect(opts.onArchiveContext).toHaveBeenCalledWith(true));
    expect(opts.loadArchive).toHaveBeenCalledOnce();
    expect(opts.bootRouter).toHaveBeenCalledOnce();
  });

  it('sends a deep link to the list when the boot cannot find its chat', async () => {
    fetchBootstrap.mockResolvedValueOnce({ me: ME, dialogs: [DIALOG] });
    const canOpen = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const opts = options({ canOpen, findDialog: vi.fn((): DialogDto | undefined => undefined) });
    renderHook(() => useShellBoot(opts));

    await vi.waitFor(() => expect(opts.replaceTo).toHaveBeenCalledWith({ view: 'list' }));
  });
});
