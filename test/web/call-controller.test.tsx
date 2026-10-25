import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallDto, GetCallDhConfigResult } from '../../apps/web/src/call-types';
import { toBase64 } from '../../apps/web/src/calls/base64';

/**
 * The calls controller's ordering rules.
 *
 * A call has three awaits before it exists (the DH config, the key pair and
 * the request), and two simultaneously — a double tap, or two updates that
 * arrive in the same batch — must not start or answer it twice. Each case here
 * is one of those windows, with the deferred promise standing where the
 * network is.
 */

const rpc = vi.hoisted(() => ({
  fetchCallDhConfig: vi.fn(),
  requestCall: vi.fn(),
  receivedCall: vi.fn(),
  acceptCall: vi.fn(),
  confirmCall: vi.fn(),
  discardCall: vi.fn(),
}));

const keys = vi.hoisted(() => ({
  validateDhConfig: vi.fn(),
  createDhKeyPair: vi.fn(),
}));

const exchange = vi.hoisted(() => ({ establishKey: vi.fn() }));

const FakePeer = vi.hoisted(() => {
  class FakePeerSession {
    static readonly instances: FakePeerSession[] = [];
    ready = false;
    muted = false;
    readonly setCipher = vi.fn((): void => {
      this.ready = true;
    });
    readonly open = vi.fn(async (): Promise<void> => {});
    readonly drain = vi.fn(async (): Promise<void> => {});
    readonly close = vi.fn();
    readonly receive = vi.fn(async (): Promise<void> => {});
    readonly setMuted = vi.fn((muted: boolean): void => {
      this.muted = muted;
    });

    constructor() {
      FakePeerSession.instances.push(this);
    }
  }
  return FakePeerSession;
});

vi.mock('../../apps/web/src/calls/api', () => rpc);
vi.mock('../../apps/web/src/calls/dh', () => keys);
vi.mock('../../apps/web/src/calls/exchange', () => exchange);
vi.mock('../../apps/web/src/calls/peer', () => ({ CallPeerSession: FakePeer }));

const { useCalls } = await import('../../apps/web/src/calls/controller');

const PRIME = new Uint8Array(256).fill(11);
const DH_CONFIG = { g: 3, p: PRIME };
const KEY_PAIR = { secret: 5n, value: new Uint8Array(256).fill(2), hash: new Uint8Array(32).fill(3) };

function callDto(overrides: Partial<CallDto> = {}): CallDto {
  return {
    id: '9',
    date: 0,
    adminId: 7,
    participantId: 8,
    video: false,
    p2pAllowed: true,
    conferenceSupported: false,
    state: 'requested',
    protocol: { udpP2p: true, udpReflector: false, minLayer: 65, maxLayer: 92, libraryVersions: ['1.0.0'] },
    connections: [],
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mount() {
  const send = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useCalls(send, onError));
  return { ...hook, send, onError };
}

beforeEach(() => {
  FakePeer.instances.length = 0;
  keys.validateDhConfig.mockResolvedValue(DH_CONFIG);
  keys.createDhKeyPair.mockResolvedValue(KEY_PAIR);
  exchange.establishKey.mockResolvedValue({ key: new Uint8Array(256).fill(7), fingerprint: '4242' });
  rpc.receivedCall.mockResolvedValue({ ok: true });
  rpc.acceptCall.mockResolvedValue({ call: callDto({ state: 'accepted' }) });
  rpc.discardCall.mockResolvedValue({ ok: true });
  rpc.confirmCall.mockResolvedValue({ call: callDto({ state: 'active', gAOrB: toBase64(KEY_PAIR.value) }) });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useCalls startCall', () => {
  it('refuses a second call while the first is still being requested', async () => {
    const config = deferred<GetCallDhConfigResult>();
    rpc.fetchCallDhConfig.mockReturnValue(config.promise);
    rpc.requestCall.mockResolvedValue({ call: callDto() });
    const { result, onError } = mount();

    act(() => {
      result.current.startCall(7);
      result.current.startCall(7);
    });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'A call is already in progress' }));

    await act(async () => {
      config.resolve({ g: DH_CONFIG.g, p: toBase64(PRIME), version: 0 });
      await config.promise;
    });

    await waitFor(() => expect(result.current.view?.phase).toBe('ringing'));
    expect(rpc.requestCall).toHaveBeenCalledOnce();
    expect(FakePeer.instances).toHaveLength(1);
  });

  it('starts a new call after the previous one ended', async () => {
    rpc.fetchCallDhConfig.mockResolvedValue({ g: DH_CONFIG.g, p: toBase64(PRIME), version: 0 });
    rpc.requestCall.mockResolvedValue({ call: callDto() });
    const { result, onError } = mount();

    await act(async () => {
      result.current.startCall(7);
    });
    await waitFor(() => expect(result.current.view?.phase).toBe('ringing'));

    act(() => result.current.hangUp());
    await waitFor(() => expect(result.current.view?.phase).toBe('ended'));

    await act(async () => {
      result.current.startCall(7);
    });
    await waitFor(() => expect(result.current.view?.phase).toBe('ringing'));

    expect(rpc.requestCall).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('useCalls accept', () => {
  it('answers an incoming call once when the button is tapped twice', async () => {
    const config = deferred<GetCallDhConfigResult>();
    rpc.fetchCallDhConfig.mockReturnValue(config.promise);
    const { result } = mount();

    act(() => result.current.handleUpdate({ type: 'call', call: callDto() }));
    await waitFor(() => expect(result.current.view?.phase).toBe('ringing'));

    act(() => {
      result.current.accept();
      result.current.accept();
    });

    await act(async () => {
      config.resolve({ g: DH_CONFIG.g, p: toBase64(PRIME), version: 0 });
      await config.promise;
    });

    await waitFor(() => expect(rpc.acceptCall).toHaveBeenCalledOnce());
  });
});

describe('useCalls duplicate updates', () => {
  it('confirms the key exchange once when two accepted updates arrive together', async () => {
    rpc.fetchCallDhConfig.mockResolvedValue({ g: DH_CONFIG.g, p: toBase64(PRIME), version: 0 });
    rpc.requestCall.mockResolvedValue({ call: callDto() });
    const established = deferred<{ key: Uint8Array; fingerprint: string }>();
    exchange.establishKey.mockReturnValue(established.promise);
    const { result } = mount();

    await act(async () => {
      result.current.startCall(7);
    });
    await waitFor(() => expect(result.current.view?.phase).toBe('ringing'));

    const accepted = callDto({ state: 'accepted', gB: toBase64(KEY_PAIR.value) });
    act(() => {
      result.current.handleUpdate({ type: 'call', call: accepted });
      result.current.handleUpdate({ type: 'call', call: accepted });
    });

    await waitFor(() => expect(exchange.establishKey).toHaveBeenCalledOnce());

    await act(async () => {
      established.resolve({ key: new Uint8Array(256).fill(7), fingerprint: '4242' });
      await established.promise;
    });

    await waitFor(() => expect(rpc.confirmCall).toHaveBeenCalledOnce());
  });

  it('derives the callee key once when two active updates arrive together', async () => {
    rpc.fetchCallDhConfig.mockResolvedValue({ g: DH_CONFIG.g, p: toBase64(PRIME), version: 0 });
    const established = deferred<{ key: Uint8Array; fingerprint: string }>();
    exchange.establishKey.mockReturnValue(established.promise);
    const { result } = mount();

    act(() => result.current.handleUpdate({ type: 'call', call: callDto({ gAHash: toBase64(KEY_PAIR.hash) }) }));
    await waitFor(() => expect(result.current.view?.phase).toBe('ringing'));

    await act(async () => {
      result.current.accept();
    });
    await waitFor(() => expect(rpc.acceptCall).toHaveBeenCalledOnce());

    const active = callDto({ state: 'active', gAOrB: toBase64(KEY_PAIR.value) });
    act(() => {
      result.current.handleUpdate({ type: 'call', call: active });
      result.current.handleUpdate({ type: 'call', call: active });
    });

    await waitFor(() => expect(exchange.establishKey).toHaveBeenCalledOnce());

    await act(async () => {
      established.resolve({ key: new Uint8Array(256).fill(7), fingerprint: '4242' });
      await established.promise;
    });

    await waitFor(() => expect(FakePeer.instances[0]?.setCipher).toHaveBeenCalledOnce());
  });
});
