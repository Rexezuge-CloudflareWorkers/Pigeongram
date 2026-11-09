import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileDto } from '../../apps/web/src/types';

/**
 * The on-demand profile read: a cached answer is free, a read in flight is not
 * repeated, and an answer for a peer the reader has left is dropped.
 */

const api = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock('../../apps/web/src/api', () => api);

const { useProfile } = await import('../../apps/web/src/useProfile');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function profile(id: number, title = `Peer ${String(id)}`): ProfileDto {
  return { id, kind: 'user', title, username: null, about: null, photo: null, membersCount: null };
}

describe('useProfile', () => {
  it('reads a profile on demand', async () => {
    api.fetchProfile.mockResolvedValue({ profile: profile(2) });
    const { result } = renderHook(() => useProfile(2));

    act(() => result.current.read(2));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.profile).toEqual(profile(2)));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('serves a profile it has already read without another request', async () => {
    api.fetchProfile.mockResolvedValue({ profile: profile(2) });
    const { result } = renderHook(() => useProfile(2));

    act(() => result.current.read(2));
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    act(() => result.current.read(2));
    expect(result.current.profile).toEqual(profile(2));
    expect(api.fetchProfile).toHaveBeenCalledOnce();
  });

  it('does not repeat a read that is already in flight', async () => {
    let resolve: (value: { profile: ProfileDto }) => void = () => {};
    api.fetchProfile.mockImplementation(() => new Promise((done) => (resolve = done)));
    const { result } = renderHook(() => useProfile(2));

    act(() => result.current.read(2));
    act(() => result.current.read(2));

    expect(api.fetchProfile).toHaveBeenCalledOnce();
    resolve({ profile: profile(2) });
    await waitFor(() => expect(result.current.profile).not.toBeNull());
  });

  it('reports a failed read with the failure text', async () => {
    api.fetchProfile.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useProfile(2));

    act(() => result.current.read(2));

    await waitFor(() => expect(result.current.error).toBe('offline'));
    expect(result.current.loading).toBe(false);
  });

  it('renders a non-Error failure readably', async () => {
    api.fetchProfile.mockRejectedValue('nope');
    const { result } = renderHook(() => useProfile(2));

    act(() => result.current.read(2));

    await waitFor(() => expect(result.current.error).toBe('nope'));
  });

  it('drops an answer for a peer the reader has left', async () => {
    let resolveFirst: (value: { profile: ProfileDto }) => void = () => {};
    api.fetchProfile
      .mockImplementationOnce(() => new Promise((done) => (resolveFirst = done)))
      .mockResolvedValueOnce({ profile: profile(3) });
    const { result, rerender } = renderHook(({ peer }) => useProfile(peer), { initialProps: { peer: 2 } });

    act(() => result.current.read(2));
    rerender({ peer: 3 });
    act(() => result.current.read(3));
    await waitFor(() => expect(result.current.profile).toEqual(profile(3)));

    resolveFirst({ profile: profile(2) });
    await Promise.resolve();

    expect(result.current.profile).toEqual(profile(3));
  });

  it('keeps the cache to its limit', async () => {
    api.fetchProfile.mockImplementation(async (id: number) => ({ profile: profile(id) }));
    const { result } = renderHook(() => useProfile(1));

    for (let id = 1; id <= 9; id += 1) {
      act(() => result.current.read(id));
      await waitFor(() => expect(api.fetchProfile).toHaveBeenCalledTimes(id));
    }

    // The first profile fell out, so reading it again is a fresh request.
    act(() => result.current.read(1));
    await waitFor(() => expect(api.fetchProfile).toHaveBeenCalledTimes(10));
  });

  it('describes no peer when the screen names none', () => {
    const { result } = renderHook(() => useProfile(null));

    expect(result.current.profile).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
