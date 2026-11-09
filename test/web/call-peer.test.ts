import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallConnectionDto, CallDto } from '../../apps/web/src/call-types';
import { CallCipher } from '../../apps/web/src/calls/crypto';
import { toBase64 } from '../../apps/web/src/calls/base64';
import { CallPeerSession } from '../../apps/web/src/calls/peer';
import { encodeSignal } from '../../apps/web/src/calls/signalling';
import { CallPeer, iceServersFor } from '../../apps/web/src/calls/webrtc';
import type { CallPeerDeps } from '../../apps/web/src/calls/webrtc';

/**
 * The connection's lifecycle.
 *
 * The failures worth pinning are the ones a browser cannot replay on demand:
 * the microphone resolving after the call ended, a track without a stream,
 * and a malformed session description. Each one leaks the microphone or
 * leaves a call that never reports failure.
 */

interface FakeTrack {
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeStream {
  tracks: FakeTrack[];
  getTracks(): FakeTrack[];
  getAudioTracks(): FakeTrack[];
}

function stream(tracks = 1): FakeStream {
  const made: FakeTrack[] = Array.from({ length: tracks }, () => ({ enabled: true, stop: vi.fn() }));
  return {
    tracks: made,
    getTracks: () => made,
    getAudioTracks: () => made,
  };
}

interface FakeConnection {
  listeners: Map<string, Array<(event: unknown) => void>>;
  closed: number;
  tracks: unknown[];
  addEventListener(type: string, listener: (event: unknown) => void): void;
  addTrack(track: unknown, media: unknown): void;
  close(): void;
  connectionState: RTCPeerConnectionState;
  createOffer(): Promise<{ type: 'offer'; sdp: string }>;
  setLocalDescription(description: unknown): Promise<void>;
  setRemoteDescription(description: unknown): Promise<void>;
  createAnswer(): Promise<{ type: 'answer'; sdp: string }>;
  addIceCandidate(candidate: unknown): Promise<void>;
}

function connection(): FakeConnection {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  return {
    listeners,
    closed: 0,
    tracks: [],
    connectionState: 'new',
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    addTrack(track) {
      this.tracks.push(track);
    },
    close() {
      this.closed += 1;
      this.connectionState = 'closed';
    },
    async createOffer() {
      return { type: 'offer', sdp: 'offer' };
    },
    async setLocalDescription() {},
    async setRemoteDescription() {},
    async createAnswer() {
      return { type: 'answer', sdp: 'answer' };
    },
    async addIceCandidate() {},
  };
}

function handlers() {
  return { onCandidate: vi.fn(), onTrack: vi.fn(), onState: vi.fn() };
}

function connectionDto(overrides: Partial<CallConnectionDto> = {}): CallConnectionDto {
  return {
    id: '1',
    ip: '',
    ipv6: '',
    port: 0,
    turn: false,
    stun: false,
    username: '',
    password: '',
    tcp: false,
    peerTag: '',
    ...overrides,
  };
}

function deps(overrides: Partial<CallPeerDeps> = {}): CallPeerDeps {
  return {
    createConnection: () => connection() as unknown as RTCPeerConnection,
    mediaDevices: { getUserMedia: vi.fn(async () => stream() as unknown as MediaStream) },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('iceServersFor', () => {
  it('turns Telegram endpoints into TURN and STUN entries', () => {
    expect(
      iceServersFor([
        connectionDto({ ip: '1.2.3.4', port: 3478, turn: true, username: 'u', password: 'p' }),
        connectionDto({ ip: '5.6.7.8', ipv6: '::1', port: 19_302, stun: true }),
      ]),
    ).toEqual([{ urls: 'turn:1.2.3.4:3478?transport=udp', username: 'u', credential: 'p' }, { urls: 'stun:[::1]:19302' }]);
  });

  it('skips an endpoint without an address or a port', () => {
    expect(
      iceServersFor([
        connectionDto({ port: 1, turn: true, stun: true }),
        connectionDto({ ip: '1.2.3.4', port: 0, turn: true, stun: true }),
      ]),
    ).toEqual([]);
  });
});

describe('CallPeer', () => {
  it('stops a microphone that resolves after the call closed', async () => {
    let resolveMicrophone: (value: MediaStream) => void = () => {};
    const microphone = stream();
    const mediaDevices = {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolveMicrophone = resolve;
          }),
      ),
    };
    const peer = new CallPeer([], handlers(), deps({ mediaDevices }));
    const opening = peer.openMicrophone();
    peer.close();
    resolveMicrophone(microphone as unknown as MediaStream);
    await opening;

    expect(microphone.tracks[0]!.stop).toHaveBeenCalledOnce();
    expect(peer.muted).toBe(false);
  });

  it('puts the microphone on the connection while the call is up', async () => {
    const microphone = stream(2);
    const created = connection();
    const peer = new CallPeer(
      [],
      handlers(),
      deps({
        createConnection: () => created as unknown as RTCPeerConnection,
        mediaDevices: { getUserMedia: vi.fn(async () => microphone as unknown as MediaStream) },
      }),
    );
    await peer.openMicrophone();
    expect(created.tracks).toEqual(microphone.tracks);
    peer.setMuted(true);
    expect(microphone.tracks.every((track) => !track.enabled)).toBe(true);
    expect(peer.muted).toBe(true);
  });

  it('wraps a track that arrives without a stream', () => {
    const created = connection();
    class FakeMediaStream {
      constructor(readonly tracks: unknown[]) {}
    }
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const heard = handlers();
    const peer = new CallPeer([], heard, deps({ createConnection: () => created as unknown as RTCPeerConnection }));
    const track = { kind: 'audio' };

    const listener = created.listeners.get('track')?.[0];
    expect(listener).toBeTypeOf('function');
    listener?.({ track, streams: [] });

    expect(heard.onTrack).toHaveBeenCalledOnce();
    expect((heard.onTrack.mock.calls[0]![0] as FakeMediaStream).tracks).toEqual([track]);
    expect(peer.muted).toBe(false);
  });

  it('reports a stream the browser did send', () => {
    const created = connection();
    const heard = handlers();
    const peer = new CallPeer([], heard, deps({ createConnection: () => created as unknown as RTCPeerConnection }));
    const sent = { id: 'stream' };

    created.listeners.get('track')?.[0]?.({ track: {}, streams: [sent] });

    expect(heard.onTrack).toHaveBeenCalledWith(sent);
    expect(peer.muted).toBe(false);
  });

  it('is idempotent on close', async () => {
    const created = connection();
    const microphone = stream();
    const peer = new CallPeer(
      [],
      handlers(),
      deps({
        createConnection: () => created as unknown as RTCPeerConnection,
        mediaDevices: { getUserMedia: vi.fn(async () => microphone as unknown as MediaStream) },
      }),
    );
    await peer.openMicrophone();
    peer.close();
    peer.close();
    expect(created.closed).toBe(1);
    expect(microphone.tracks[0]!.stop).toHaveBeenCalledOnce();
  });
});

function callDto(overrides: Partial<CallDto> = {}): CallDto {
  return {
    id: '1',
    date: 0,
    adminId: 7,
    participantId: 8,
    video: false,
    p2pAllowed: true,
    conferenceSupported: false,
    state: 'active',
    protocol: { udpP2p: true, udpReflector: false, minLayer: 65, maxLayer: 92, libraryVersions: ['1.0.0'] },
    connections: [],
    ...overrides,
  };
}

function fakePeer(overrides: Record<string, unknown> = {}) {
  return {
    openMicrophone: vi.fn(async () => {}),
    createOffer: vi.fn(async () => ({ type: 'offer' as const, sdp: 'offer' })),
    acceptOffer: vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer' })),
    acceptAnswer: vi.fn(async () => {}),
    addCandidate: vi.fn(async () => {}),
    setMuted: vi.fn(),
    muted: false,
    close: vi.fn(),
    ...overrides,
  };
}

describe('CallPeerSession', () => {
  it('tears a peer down when close lands during the microphone request', async () => {
    const peer = fakePeer();
    let release: () => void = () => {};
    peer.openMicrophone.mockImplementation(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const session = new CallPeerSession('1', 'incoming', vi.fn(), vi.fn(), vi.fn(), vi.fn(), {
      createPeer: () => peer,
    });
    session.setCipher(new CallCipher(new Uint8Array(256).fill(1), false));
    const opening = session.open(callDto());
    await vi.waitFor(() => expect(peer.openMicrophone).toHaveBeenCalledOnce());
    session.close();
    release();
    await opening;

    expect(peer.close).toHaveBeenCalled();
  });

  it('reports a malformed session description instead of rejecting', async () => {
    const onFailed = vi.fn();
    const peer = fakePeer({
      acceptOffer: vi.fn(async () => {
        throw new Error('invalid SDP');
      }),
    });
    const session = new CallPeerSession('1', 'incoming', vi.fn(), vi.fn(), vi.fn(), onFailed, { createPeer: () => peer });
    const shared = new Uint8Array(256).fill(2);
    session.setCipher(new CallCipher(shared, false));
    await session.open(callDto());
    const caller = new CallCipher(shared, true);
    const packet = await caller.encrypt('signaling', encodeSignal({ kind: 'offer', sdp: 'not sdp' }));

    await session.receive('1', toBase64(packet));

    expect(onFailed).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('drains queued packets in order once the key is known', async () => {
    const order: string[] = [];
    const peer = fakePeer({
      acceptOffer: vi.fn(async (description: { sdp: string }) => {
        order.push(description.sdp);
        return { sdp: 'answer' };
      }),
    });
    const session = new CallPeerSession('1', 'incoming', vi.fn(), vi.fn(), vi.fn(), vi.fn(), { createPeer: () => peer });
    const shared = new Uint8Array(256).fill(3);
    const caller = new CallCipher(shared, true);
    const first = toBase64(await caller.encrypt('signaling', encodeSignal({ kind: 'offer', sdp: 'first' })));
    const second = toBase64(await caller.encrypt('signaling', encodeSignal({ kind: 'offer', sdp: 'second' })));

    await session.receive('1', first);
    await session.receive('1', second);
    session.setCipher(new CallCipher(shared, false));
    await session.open(callDto());
    await session.drain();

    expect(order).toEqual(['first', 'second']);
  });

  it('ignores a packet addressed to another call', async () => {
    const peer = fakePeer();
    const session = new CallPeerSession('1', 'incoming', vi.fn(), vi.fn(), vi.fn(), vi.fn(), { createPeer: () => peer });
    session.setCipher(new CallCipher(new Uint8Array(256).fill(4), false));
    await session.open(callDto());
    await session.receive('2', 'not even base64');
    expect(peer.acceptOffer).not.toHaveBeenCalled();
  });
});

interface RecordingConnection extends FakeConnection {
  local: unknown[];
  remote: unknown[];
  candidates: unknown[];
}

function recordingConnection(): RecordingConnection {
  const base = connection();
  const local: unknown[] = [];
  const remote: unknown[] = [];
  const candidates: unknown[] = [];
  return {
    ...base,
    local,
    remote,
    candidates,
    async setLocalDescription(description) {
      local.push(description);
    },
    async setRemoteDescription(description) {
      remote.push(description);
    },
    async addIceCandidate(candidate) {
      candidates.push(candidate);
    },
  };
}

describe('CallPeer lifecycle', () => {
  it('reports every ICE candidate and connection-state change', () => {
    const created = recordingConnection();
    const heard = handlers();
    const peer = new CallPeer([], heard, deps({ createConnection: () => created as unknown as RTCPeerConnection }));
    expect(peer.state).toBe('new');
    const candidate = { candidate: 'candidate:1', toJSON: () => ({ candidate: 'candidate:1' }) };

    created.listeners.get('icecandidate')?.[0]?.({ candidate });
    expect(heard.onCandidate).toHaveBeenCalledWith({ candidate: 'candidate:1' });

    created.listeners.get('icecandidate')?.[0]?.({ candidate: null });
    expect(heard.onCandidate).toHaveBeenCalledOnce();

    created.connectionState = 'connected';
    created.listeners.get('connectionstatechange')?.[0]?.({});
    expect(heard.onState).toHaveBeenCalledWith('connected');
  });

  it('exposes the connection state', () => {
    const created = recordingConnection();
    const peer = new CallPeer([], handlers(), deps({ createConnection: () => created as unknown as RTCPeerConnection }));

    created.connectionState = 'connecting';
    expect(peer.state).toBe('connecting');
  });

  it('runs the offer, the answer and the remote answer through the connection', async () => {
    const created = recordingConnection();
    const peer = new CallPeer([], handlers(), deps({ createConnection: () => created as unknown as RTCPeerConnection }));

    await expect(peer.createOffer()).resolves.toEqual({ type: 'offer', sdp: 'offer' });
    expect(created.local).toEqual([{ type: 'offer', sdp: 'offer' }]);

    await expect(peer.acceptOffer({ type: 'offer', sdp: 'remote' })).resolves.toEqual({ type: 'answer', sdp: 'answer' });
    expect(created.remote).toEqual([{ type: 'offer', sdp: 'remote' }]);
    expect(created.local).toEqual([
      { type: 'offer', sdp: 'offer' },
      { type: 'answer', sdp: 'answer' },
    ]);

    await peer.acceptAnswer({ type: 'answer', sdp: 'final' });
    expect(created.remote).toEqual([
      { type: 'offer', sdp: 'remote' },
      { type: 'answer', sdp: 'final' },
    ]);
  });

  it('skips an empty candidate and swallows a late one', async () => {
    const created = recordingConnection();
    const peer = new CallPeer([], handlers(), deps({ createConnection: () => created as unknown as RTCPeerConnection }));

    await peer.addCandidate({ candidate: '' });
    expect(created.candidates).toEqual([]);

    await peer.addCandidate({ candidate: 'candidate:1' });
    expect(created.candidates).toEqual([{ candidate: 'candidate:1' }]);

    created.addIceCandidate = async () => {
      throw new Error('closed');
    };
    await expect(peer.addCandidate({ candidate: 'candidate:2' })).resolves.toBeUndefined();
  });

  it('leaves muting alone until the microphone is open', () => {
    const peer = new CallPeer([], handlers(), deps({ createConnection: () => connection() as unknown as RTCPeerConnection }));

    peer.setMuted(true);

    expect(peer.muted).toBe(false);
  });
});

describe('CallPeerSession lifecycle', () => {
  function sessionHarness(direction: 'outgoing' | 'incoming' = 'incoming') {
    const peer = fakePeer();
    let captured: ConstructorParameters<typeof CallPeer>[1] | null = null;
    const send = vi.fn();
    const onStream = vi.fn();
    const onConnected = vi.fn();
    const onFailed = vi.fn();
    const session = new CallPeerSession('1', direction, send, onStream, onConnected, onFailed, {
      createPeer: (_connections, handlers) => {
        captured = handlers;
        return peer;
      },
    });
    return { peer, send, onStream, onConnected, onFailed, session, handlers: () => captured };
  }

  it('reports readiness only once the cipher is set', async () => {
    const test = sessionHarness();

    expect(test.session.ready).toBe(false);
    test.session.setCipher(new CallCipher(new Uint8Array(256).fill(1), false));
    expect(test.session.ready).toBe(true);
  });

  it('opens the microphone and offers on the outgoing side', async () => {
    const test = sessionHarness('outgoing');
    test.session.setCipher(new CallCipher(new Uint8Array(256).fill(1), true));

    await test.session.open(callDto());

    expect(test.peer.openMicrophone).toHaveBeenCalledOnce();
    expect(test.peer.createOffer).toHaveBeenCalledOnce();
    expect(test.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'call_signaling', callId: '1', data: expect.any(String) as string }),
    );
  });

  it('does not offer on the incoming side', async () => {
    const test = sessionHarness('incoming');
    test.session.setCipher(new CallCipher(new Uint8Array(256).fill(1), false));

    await test.session.open(callDto());

    expect(test.peer.openMicrophone).toHaveBeenCalledOnce();
    expect(test.peer.createOffer).not.toHaveBeenCalled();
  });

  it('reports the peer handlers', async () => {
    const test = sessionHarness();
    test.session.setCipher(new CallCipher(new Uint8Array(256).fill(1), false));
    await test.session.open(callDto());
    const handlers = test.handlers()!;
    const stream = {} as MediaStream;

    handlers.onTrack(stream);
    expect(test.onStream).toHaveBeenCalledWith(stream);

    handlers.onState('connected');
    expect(test.onConnected).toHaveBeenCalledOnce();

    handlers.onState('failed');
    expect(test.onFailed).toHaveBeenCalledOnce();

    handlers.onCandidate({ candidate: 'candidate:1' });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'call_signaling', callId: '1' })));
  });

  it('forwards mute changes to the peer once it exists', async () => {
    const test = sessionHarness();
    test.session.setCipher(new CallCipher(new Uint8Array(256).fill(1), false));
    await test.session.open(callDto());

    test.session.setMuted(true);
    expect(test.peer.setMuted).toHaveBeenCalledWith(true);
    expect(test.session.muted).toBe(false);

    test.peer.muted = true;
    expect(test.session.muted).toBe(true);
  });

  it('does nothing before the key is known', async () => {
    const test = sessionHarness();

    await test.session.sendSignal({ kind: 'offer', sdp: 'offer' });
    await test.session.drain();

    expect(test.send).not.toHaveBeenCalled();
  });

  it('ignores malformed, undecryptable and undecodable packets', async () => {
    const test = sessionHarness();
    const shared = new Uint8Array(256).fill(9);
    test.session.setCipher(new CallCipher(shared, false));
    await test.session.open(callDto());

    await test.session.receive('1', 'not base64!');

    const other = new CallCipher(new Uint8Array(256).fill(8), true);
    await test.session.receive('1', toBase64(await other.encrypt('signaling', encodeSignal({ kind: 'offer', sdp: 'x' }))));

    const own = new CallCipher(shared, false);
    await test.session.receive('1', toBase64(await own.encrypt('signaling', new Uint8Array([1, 2, 3]))));

    expect(test.peer.acceptOffer).not.toHaveBeenCalled();
    expect(test.onFailed).not.toHaveBeenCalled();
  });

  it('acts on an answer and a candidate from the other peer', async () => {
    const test = sessionHarness();
    const shared = new Uint8Array(256).fill(7);
    test.session.setCipher(new CallCipher(shared, false));
    await test.session.open(callDto());
    const caller = new CallCipher(shared, true);

    await test.session.receive('1', toBase64(await caller.encrypt('signaling', encodeSignal({ kind: 'answer', sdp: 'answer' }))));
    await test.session.receive(
      '1',
      toBase64(await caller.encrypt('signaling', encodeSignal({ kind: 'candidate', mid: 'audio', index: 0, candidate: 'candidate:1' }))),
    );

    expect(test.peer.acceptAnswer).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer' });
    expect(test.peer.addCandidate).toHaveBeenCalledWith({ candidate: 'candidate:1', sdpMid: 'audio', sdpMLineIndex: 0 });
  });

  it('releases the call on close and ignores a late cipher', async () => {
    const test = sessionHarness();
    test.session.setCipher(new CallCipher(new Uint8Array(256).fill(1), false));
    await test.session.open(callDto());

    test.session.close();
    test.session.close();
    test.session.setCipher(new CallCipher(new Uint8Array(256).fill(2), false));

    expect(test.peer.close).toHaveBeenCalledOnce();
    expect(test.session.ready).toBe(true);
  });
});
