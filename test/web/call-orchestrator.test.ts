import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallDto, GetCallDhConfigResult } from '../../apps/web/src/call-types';
import { toBase64 } from '../../apps/web/src/calls/base64';
import { CallOrchestrator } from '../../apps/web/src/calls/orchestrator';
import type { CallPeerPort, CallRpcPort } from '../../apps/web/src/calls/orchestrator';
import type { CallPeerSession } from '../../apps/web/src/calls/peer';

/**
 * The call ordering rules without React.
 *
 * A call has three awaits before it exists (the DH config, the key pair and
 * the request), and two simultaneously — a double tap, or two updates that
 * arrive in the same batch — must not start or answer it twice. Each case here
 * is one of those windows, with a deferred promise standing where the network
 * is. A hang-up inside a window must not resurrect the call when the window
 * closes.
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

vi.mock('../../apps/web/src/calls/dh', () => keys);
vi.mock('../../apps/web/src/calls/exchange', () => exchange);

const PRIME = new Uint8Array(256).fill(11);
const DH_CONFIG = { g: 3, p: PRIME };
const KEY_PAIR = { secret: 5n, value: new Uint8Array(256).fill(2), hash: new Uint8Array(32).fill(3) };

class FakePeer {
  ready = false;
  muted = false;
  readonly setCipher = vi.fn((): void => {
    this.ready = true;
  });
  readonly open = vi.fn(async (_call: CallDto): Promise<void> => {});
  readonly drain = vi.fn(async (): Promise<void> => {});
  readonly close = vi.fn();
  readonly receive = vi.fn(async (): Promise<void> => {});
  readonly setMuted = vi.fn((muted: boolean): void => {
    this.muted = muted;
  });
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

function mount(overrides: { now?: () => number } = {}) {
  const dispatch = vi.fn();
  const setRemoteStream = vi.fn();
  const onError = vi.fn();
  const send = vi.fn();
  const peers: FakePeer[] = [];
  const orchestrator = new CallOrchestrator({
    dispatch,
    setRemoteStream,
    onError,
    send,
    rpc: rpc as unknown as CallRpcPort,
    createPeer: (_port: CallPeerPort): CallPeerSession => {
      const peer = new FakePeer();
      peers.push(peer);
      return peer as unknown as CallPeerSession;
    },
    now: overrides.now ?? (() => 1000),
  });
  return { orchestrator, dispatch, setRemoteStream, onError, send, peers };
}

beforeEach(() => {
  keys.validateDhConfig.mockResolvedValue(DH_CONFIG);
  keys.createDhKeyPair.mockResolvedValue(KEY_PAIR);
  exchange.establishKey.mockResolvedValue({ key: new Uint8Array(256).fill(7), fingerprint: '4242' });
  rpc.fetchCallDhConfig.mockResolvedValue({ g: DH_CONFIG.g, p: toBase64(PRIME), version: 0 });
  rpc.requestCall.mockResolvedValue({ call: callDto() });
  rpc.receivedCall.mockResolvedValue({ ok: true });
  rpc.acceptCall.mockResolvedValue({ call: callDto({ state: 'accepted' }) });
  rpc.confirmCall.mockResolvedValue({ call: callDto({ state: 'active', gAOrB: toBase64(KEY_PAIR.value) }) });
  rpc.discardCall.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CallOrchestrator.startCall', () => {
  it('refuses a second call while the first is still being requested', async () => {
    const config = deferred<GetCallDhConfigResult>();
    rpc.fetchCallDhConfig.mockReturnValue(config.promise);
    const { orchestrator, dispatch, onError } = mount();

    orchestrator.startCall(7);
    orchestrator.startCall(7);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'A call is already in progress' }));

    config.resolve({ g: DH_CONFIG.g, p: toBase64(PRIME), version: 0 });
    await config.promise;

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'outgoing', callId: '9', chatId: 7, peerId: 7 }));
    expect(rpc.requestCall).toHaveBeenCalledOnce();
  });

  it('refuses a second call while one is up', () => {
    const { orchestrator, onError } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });

    orchestrator.startCall(7);

    expect(rpc.requestCall).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('starts a new call after the previous one ended', async () => {
    const { orchestrator } = mount();

    orchestrator.startCall(7);
    await vi.waitFor(() => expect(rpc.requestCall).toHaveBeenCalledTimes(1));
    orchestrator.hangUp();

    orchestrator.startCall(7);
    await vi.waitFor(() => expect(rpc.requestCall).toHaveBeenCalledTimes(2));
  });

  it('drops a call requested after the page went away', async () => {
    const request = deferred<{ call: CallDto }>();
    rpc.requestCall.mockReturnValue(request.promise);
    const { orchestrator, dispatch } = mount();

    orchestrator.startCall(7);
    await vi.waitFor(() => expect(rpc.requestCall).toHaveBeenCalledOnce());
    orchestrator.dispose();
    request.resolve({ call: callDto() });
    await request.promise;

    await vi.waitFor(() => expect(rpc.discardCall).toHaveBeenCalledWith({ callId: '9', reason: 'hangup', duration: 0 }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'outgoing' }));
  });
});

describe('CallOrchestrator.accept', () => {
  it('answers an incoming call once when the button is tapped twice', async () => {
    const config = deferred<GetCallDhConfigResult>();
    rpc.fetchCallDhConfig.mockReturnValue(config.promise);
    const { orchestrator } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });

    orchestrator.accept();
    orchestrator.accept();

    config.resolve({ g: DH_CONFIG.g, p: toBase64(PRIME), version: 0 });
    await config.promise;

    await vi.waitFor(() => expect(rpc.acceptCall).toHaveBeenCalledOnce());
  });

  it('does not answer a call it has already hung up during the key exchange', async () => {
    const keyPair = deferred<typeof KEY_PAIR>();
    keys.createDhKeyPair.mockReturnValue(keyPair.promise);
    const { orchestrator, dispatch } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });

    orchestrator.accept();
    await vi.waitFor(() => expect(keys.createDhKeyPair).toHaveBeenCalledOnce());
    orchestrator.hangUp();

    keyPair.resolve(KEY_PAIR);
    await keyPair.promise;

    await vi.waitFor(() => expect(rpc.discardCall).toHaveBeenCalledWith({ callId: '9', reason: 'hangup', duration: 0 }));
    expect(rpc.acceptCall).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'phase', callId: '9', phase: 'connecting' });
  });

  it('reports a failed accept and releases the call', async () => {
    keys.createDhKeyPair.mockRejectedValue(new Error('not enough entropy'));
    const { orchestrator, dispatch, peers } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });

    orchestrator.accept();

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'failed', callId: '9', error: 'not enough entropy' }));
    expect(peers[0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe('CallOrchestrator duplicate updates', () => {
  it('confirms the key exchange once when two accepted updates arrive together', async () => {
    const established = deferred<{ key: Uint8Array; fingerprint: string }>();
    exchange.establishKey.mockReturnValue(established.promise);
    const { orchestrator } = mount();
    orchestrator.startCall(7);
    await vi.waitFor(() => expect(rpc.requestCall).toHaveBeenCalledOnce());

    const accepted = callDto({ state: 'accepted', gB: toBase64(KEY_PAIR.value) });
    orchestrator.handleUpdate({ type: 'call', call: accepted });
    orchestrator.handleUpdate({ type: 'call', call: accepted });

    await vi.waitFor(() => expect(exchange.establishKey).toHaveBeenCalledOnce());

    established.resolve({ key: new Uint8Array(256).fill(7), fingerprint: '4242' });
    await established.promise;

    await vi.waitFor(() => expect(rpc.confirmCall).toHaveBeenCalledOnce());
  });

  it('does not confirm a call it has hung up during the key exchange', async () => {
    const established = deferred<{ key: Uint8Array; fingerprint: string }>();
    exchange.establishKey.mockReturnValue(established.promise);
    const { orchestrator } = mount();
    orchestrator.startCall(7);
    await vi.waitFor(() => expect(rpc.requestCall).toHaveBeenCalledOnce());

    orchestrator.handleUpdate({ type: 'call', call: callDto({ state: 'accepted', gB: toBase64(KEY_PAIR.value) }) });
    await vi.waitFor(() => expect(exchange.establishKey).toHaveBeenCalledOnce());
    orchestrator.hangUp();

    established.resolve({ key: new Uint8Array(256).fill(7), fingerprint: '4242' });
    await established.promise;

    await vi.waitFor(() => expect(rpc.discardCall).toHaveBeenCalledWith({ callId: '9', reason: 'hangup', duration: 0 }));
    expect(rpc.confirmCall).not.toHaveBeenCalled();
  });

  it('derives the callee key once when two active updates arrive together', async () => {
    const established = deferred<{ key: Uint8Array; fingerprint: string }>();
    exchange.establishKey.mockReturnValue(established.promise);
    const { orchestrator, peers } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto({ gAHash: toBase64(KEY_PAIR.hash) }) });
    orchestrator.accept();
    await vi.waitFor(() => expect(rpc.acceptCall).toHaveBeenCalledOnce());

    const active = callDto({ state: 'active', gAOrB: toBase64(KEY_PAIR.value) });
    orchestrator.handleUpdate({ type: 'call', call: active });
    orchestrator.handleUpdate({ type: 'call', call: active });

    await vi.waitFor(() => expect(exchange.establishKey).toHaveBeenCalledOnce());

    established.resolve({ key: new Uint8Array(256).fill(7), fingerprint: '4242' });
    await established.promise;

    await vi.waitFor(() => expect(peers[0]?.setCipher).toHaveBeenCalledOnce());
  });

  it('ignores a call update that belongs to another call', async () => {
    const { orchestrator, dispatch, peers } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });

    orchestrator.handleUpdate({ type: 'call', call: callDto({ id: '10', state: 'discarded' }) });

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'ended', callId: '10' });
    expect(peers[0]?.close).not.toHaveBeenCalled();
  });

  it('relays a signalling packet to the live peer', () => {
    const { orchestrator, peers } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });

    orchestrator.handleUpdate({ type: 'call_signaling', callId: '9', data: 'AAAA' });

    expect(peers[0]?.receive).toHaveBeenCalledWith('9', 'AAAA');
  });
});

describe('CallOrchestrator lifecycle', () => {
  it('ends a discarded call and releases the peer', () => {
    const { orchestrator, dispatch, peers, setRemoteStream } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });

    orchestrator.handleUpdate({ type: 'call', call: callDto({ state: 'discarded' }) });

    expect(dispatch).toHaveBeenCalledWith({ type: 'ended', callId: '9' });
    expect(peers[0]?.close).toHaveBeenCalledTimes(1);
    expect(setRemoteStream).toHaveBeenCalledWith(null);
  });

  it('declines with the missed reason and hangs up with the duration', async () => {
    const { orchestrator } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });
    orchestrator.decline();
    await vi.waitFor(() => expect(rpc.discardCall).toHaveBeenCalledWith({ callId: '9', reason: 'missed', duration: 0 }));

    orchestrator.startCall(7);
    await vi.waitFor(() => expect(rpc.requestCall).toHaveBeenCalledOnce());
    orchestrator.hangUp();
    await vi.waitFor(() => expect(rpc.discardCall).toHaveBeenCalledWith({ callId: '9', reason: 'hangup', duration: 0 }));
  });

  it('toggles the microphone on the live peer', () => {
    const { orchestrator, dispatch, peers } = mount();
    orchestrator.handleUpdate({ type: 'call', call: callDto() });

    orchestrator.toggleMute();

    expect(peers[0]?.setMuted).toHaveBeenCalledWith(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'muted', callId: '9', muted: true });
  });
});
