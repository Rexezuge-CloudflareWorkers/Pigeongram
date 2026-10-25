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
