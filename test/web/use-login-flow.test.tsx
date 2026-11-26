import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '@rexezuge/errors';

const api = vi.hoisted(() => ({
  getState: vi.fn(),
  startQr: vi.fn(),
  isAuthError: vi.fn((failure: unknown) => failure instanceof ServiceError && failure.status === 401),
  startPhoneLogin: vi.fn(),
  submitLoginCode: vi.fn(),
  submitPassword: vi.fn(),
  cancelLogin: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../apps/web/src/api', () => api);

const { useLoginFlow } = await import('../../apps/web/src/useLoginFlow');

const unauthorized = { phase: 'unauthorized', authorized: false, me: null };
const qr = { phase: 'qr', authorized: false, me: null, qrUrl: 'https://t.me/qr', qrExpires: 1 };

function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void } {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useLoginFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getState.mockResolvedValue(unauthorized);
    api.startQr.mockResolvedValue(qr);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts one QR login even when a visibility change overlaps a slow probe', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    api.getState.mockReturnValue(pending.promise);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    const { unmount } = renderHook(() => useLoginFlow());
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // The two visibility events arrived while the first probe was in flight;
    // they must not start a second QR rotation.
    expect(api.startQr).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(unauthorized);
    });

    expect(api.startQr).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('probes the public health endpoint when the bridge fetch fails', async () => {
    const health = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', health);
    api.getState.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result, unmount } = renderHook(() => useLoginFlow());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.access).toBe('anonymous');
    unmount();
  });
});
