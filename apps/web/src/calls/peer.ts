import type { CallDto } from '../call-types';
import type { ClientSocketMessage } from '../types';
import { fromBase64, toBase64 } from './base64';
import { CallCipher } from './crypto';
import { decodeSignal, encodeSignal } from './signalling';
import type { SignalMessage } from './signalling';
import { CallPeer } from './webrtc';

/**
 * The media peer the session drives. `CallPeer` is the real one; tests pass a
 * stand-in with the same surface.
 */
export type MediaPeer = Pick<
  CallPeer,
  'openMicrophone' | 'createOffer' | 'acceptOffer' | 'acceptAnswer' | 'addCandidate' | 'setMuted' | 'muted' | 'close'
>;

/**
 * How a session makes its media peer. Injectable so the signalling lifecycle
 * can be tested without a real RTCPeerConnection.
 */
export interface CallPeerSessionDeps {
  createPeer?: (connections: CallDto['connections'], handlers: ConstructorParameters<typeof CallPeer>[1]) => MediaPeer;
}

/**
 * The media plane of one call.
 *
 * Two things live here: the peer connection, which carries the audio, and the
 * signalling channel, which carries the handshake that sets it up. The
 * signalling is encrypted with the call's shared key, so the session
 * description — and with it the DTLS fingerprint the peer connection is
 * checked against — cannot have been swapped on the way.
 *
 * The class knows nothing about the call's state: it is handed the cipher
 * once the key exchange is over, and it reports what it learns.
 */
export class CallPeerSession {
  /**
   * The cipher of the signalling channel; null until the key is known.
   */
  #cipher: CallCipher | null = null;

  /**
   * The peer connection; null until the media is set up.
   */
  #peer: MediaPeer | null = null;

  /**
   * Signalling packets that arrived before the key was ready.
   *
   * The other peer may start talking before this side has finished the
   * exchange, and a packet dropped here would be a handshake that never
   * completes.
   */
  readonly #pending: string[] = [];

  /**
   * Resolves once the key is known — or once the call is over, so a caller
   * waiting for the key is not left hanging.
   */
  readonly #ready: Promise<void>;

  #markReady: () => void = () => {};

  #closed = false;

  constructor(
    private readonly callId: string,
    private readonly direction: 'outgoing' | 'incoming',
    private readonly send: (message: ClientSocketMessage) => void,
    private readonly onStream: (stream: MediaStream) => void,
    private readonly onConnected: () => void,
    private readonly onFailed: () => void,
    private readonly deps: CallPeerSessionDeps = {},
  ) {
    this.#ready = new Promise((resolve) => {
      this.#markReady = resolve;
    });
  }

  /**
   * Hands over the cipher of the signalling channel.
   */
  setCipher(cipher: CallCipher): void {
    if (this.#closed) return;
    this.#cipher = cipher;
    this.#markReady();
  }

  /**
   * Whether the key is known, and the signalling can be read and written.
   */
  get ready(): boolean {
    return this.#cipher !== null;
  }

  /**
   * Sets the media connection up and starts the handshake.
   *
   * The caller offers and the callee answers: only one side may offer, or the
   * two would contradict each other.
   *
   * The wait for the key matters: the handshake is encrypted, so a peer
   * connection opened before the exchange is over could not say anything.
   */
  async open(call: CallDto): Promise<void> {
    await this.#ready;
    if (this.#closed || this.#peer) return;
    const handlers = {
      onCandidate: (candidate: RTCIceCandidateInit): void => {
        void this.sendSignal({
          kind: 'candidate',
          mid: candidate.sdpMid ?? null,
          index: candidate.sdpMLineIndex ?? 0,
          candidate: candidate.candidate ?? '',
        });
      },
      onTrack: (stream: MediaStream): void => this.onStream(stream),
      onState: (state: RTCPeerConnectionState): void => {
        if (state === 'connected') this.onConnected();
        if (state === 'failed') this.onFailed();
      },
    };
    const peer = this.deps.createPeer?.(call.connections, handlers) ?? new CallPeer(call.connections, handlers);
    this.#peer = peer;
    await peer.openMicrophone();
    if (this.#closed || this.#peer !== peer) {
      // The call ended while the microphone was being opened. The peer that
      // was just created never joined the call, so tear it down here rather
      // than let its microphone outlive the call.
      peer.close();
      return;
    }
    if (this.direction !== 'outgoing') return;
    const offer = await peer.createOffer();
    await this.sendSignal({ kind: 'offer', sdp: offer.sdp ?? '' });
  }

  /**
   * Reads a signalling packet the other peer sent.
   *
   * A packet for another call is not ours, and a packet that arrives before
   * the key is ready waits: the other peer may start talking before this side
   * has finished the exchange, and a packet dropped here would be a handshake
   * that never completes.
   */
  async receive(callId: string, data: string): Promise<void> {
    if (this.#closed || callId !== this.callId) return;
    if (!this.#cipher) {
      this.#pending.push(data);
      return;
    }
    try {
      const packet = fromBase64(data);
      if (packet === null) return;
      const plain = await this.#cipher.decrypt('signaling', packet);
      if (plain === null) return;
      const message = decodeSignal(plain);
      if (message === null) return;
      await this.#act(message);
    } catch (error) {
      // A malformed session description or candidate is the other peer's
      // failure to describe its media, and it leaves this side unable to
      // connect. Report it and release the microphone instead of surfacing an
      // unhandled rejection.
      console.error('[call] signalling failed', error);
      this.#fail();
    }
  }

  /**
   * The packets that waited for the key are handled now.
   */
  async drain(): Promise<void> {
    if (!this.#cipher) return;
    const waiting = this.#pending.splice(0);
    for (const data of waiting) {
      await this.receive(this.callId, data);
    }
  }

  /**
   * Sends a signalling packet to the other peer.
   */
  async sendSignal(message: SignalMessage): Promise<void> {
    if (!this.#cipher) return;
    const packet = await this.#cipher.encrypt('signaling', encodeSignal(message));
    this.send({ type: 'call_signaling', callId: this.callId, data: toBase64(packet) });
  }

  /**
   * Mutes or unmutes the microphone.
   */
  setMuted(muted: boolean): void {
    this.#peer?.setMuted(muted);
  }

  /**
   * Whether the microphone is muted.
   */
  get muted(): boolean {
    return this.#peer?.muted ?? false;
  }

  /**
   * Tears the peer connection down and releases the microphone.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#peer?.close();
    this.#peer = null;
    this.#pending.length = 0;
    // Let a caller that is waiting for the key go.
    this.#markReady();
  }

  /**
   * Reports a media failure and releases the call.
   */
  #fail(): void {
    if (this.#closed) return;
    this.onFailed();
    this.close();
  }

  /**
   * Acts on a signalling message.
   */
  async #act(message: SignalMessage): Promise<void> {
    const peer = this.#peer;
    if (!peer) return;
    switch (message.kind) {
      case 'offer': {
        const answer = await peer.acceptOffer({ type: 'offer', sdp: message.sdp });
        await this.sendSignal({ kind: 'answer', sdp: answer.sdp ?? '' });
        break;
      }
      case 'answer': {
        await peer.acceptAnswer({ type: 'answer', sdp: message.sdp });
        break;
      }
      case 'candidate': {
        await peer.addCandidate({
          candidate: message.candidate,
          sdpMid: message.mid,
          sdpMLineIndex: message.index,
        });
        break;
      }
      default: {
        break;
      }
    }
  }
}
