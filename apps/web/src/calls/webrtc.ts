/**
 * The media plane of a call: the peer connection and the microphone.
 *
 * The media never comes near the worker. Telegram's server hands the two
 * peers the addresses of the relays they may use, and from there the audio
 * travels directly between the two browsers — over the relay when a direct
 * route cannot be found, and over the peer connection's own encryption
 * either way.
 *
 * The handshake that sets the peer connection up travels through the
 * signalling channel instead, which is encrypted with the call's shared key.
 * That is what authenticates the peer connection: the session description
 * arrives inside a channel only the two peers can read, so the DTLS
 * fingerprint it carries cannot have been swapped on the way.
 */

import type { CallConnectionDto } from '../call-types';

/**
 * The browser pieces a peer needs, injectable so the lifecycle can be tested
 * without a real RTCPeerConnection or a real microphone.
 */
export interface CallPeerDeps {
  /**
   * Makes the peer connection. Defaults to the browser's constructor.
   */
  createConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  /**
   * Asks for the microphone. Defaults to `navigator.mediaDevices`.
   */
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
}

/**
 * The relays the call may use.
 *
 * Telegram's call carries a list of endpoints, and the WebRTC ones are the
 * only ones a browser can speak to: a page cannot open the raw UDP socket
 * the older transport needs. The endpoint is either a TURN relay — which
 * authenticates with a username and a password — or a STUN server, which
 * only helps with discovering the address.
 */
export function iceServersFor(connections: CallConnectionDto[]): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  for (const connection of connections) {
    const host = connection.ipv6 ? `[${connection.ipv6}]` : connection.ip;
    if (!host || !connection.port) continue;
    if (connection.turn) {
      servers.push({
        urls: `turn:${host}:${connection.port}?transport=udp`,
        username: connection.username,
        credential: connection.password,
      });
    }
    if (connection.stun) {
      servers.push({ urls: `stun:${host}:${connection.port}` });
    }
  }
  return servers;
}

/**
 * The events a caller of the peer needs to hear about.
 */
export interface CallPeerHandlers {
  /**
   * A local ICE candidate, ready to be sent to the other peer.
   */
  onCandidate(candidate: RTCIceCandidateInit): void;
  /**
   * The other peer's audio arrived.
   */
  onTrack(stream: MediaStream): void;
  /**
   * The peer connection's state changed.
   */
  onState(state: RTCPeerConnectionState): void;
}

/**
 * One side of a call's peer connection.
 */
export class CallPeer {
  readonly #connection: RTCPeerConnection;
  readonly #mediaDevices: Pick<MediaDevices, 'getUserMedia'>;
  #localStream: MediaStream | null = null;
  #closed = false;

  constructor(
    connections: CallConnectionDto[],
    private readonly handlers: CallPeerHandlers,
    deps: CallPeerDeps = {},
  ) {
    const createConnection = deps.createConnection ?? ((configuration) => new RTCPeerConnection(configuration));
    this.#mediaDevices = deps.mediaDevices ?? navigator.mediaDevices;
    this.#connection = createConnection({ iceServers: iceServersFor(connections) });
    this.#connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        handlers.onCandidate(event.candidate.toJSON());
      }
    });
    this.#connection.addEventListener('track', (event) => {
      // Some browsers deliver a track without a stream; the call still needs
      // the audio, so wrap the track in one of its own.
      handlers.onTrack(event.streams[0] ?? new MediaStream([event.track]));
    });
    this.#connection.addEventListener('connectionstatechange', () => {
      handlers.onState(this.#connection.connectionState);
    });
  }

  /**
   * The state of the peer connection.
   */
  get state(): RTCPeerConnectionState {
    return this.#connection.connectionState;
  }

  /**
   * Asks for the microphone and puts it on the connection.
   *
   * The browser does the encoding — Opus over DTLS-SRTP — so nothing about
   * the audio itself is bespoke.
   */
  async openMicrophone(): Promise<void> {
    const stream = await this.#mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (this.#closed) {
      // The call ended while the browser was asking for the microphone. The
      // stream would be added to a closed connection and never stopped, and
      // the tab would keep its recording indicator.
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.#localStream = stream;
    for (const track of stream.getAudioTracks()) {
      this.#connection.addTrack(track, stream);
    }
  }

  /**
   * Makes the offer that starts the handshake.
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.#connection.createOffer();
    await this.#connection.setLocalDescription(offer);
    return offer;
  }

  /**
   * Answers the other peer's offer.
   */
  async acceptOffer(description: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.#connection.setRemoteDescription(description);
    const answer = await this.#connection.createAnswer();
    await this.#connection.setLocalDescription(answer);
    return answer;
  }

  /**
   * Takes the other peer's answer.
   */
  async acceptAnswer(description: RTCSessionDescriptionInit): Promise<void> {
    await this.#connection.setRemoteDescription(description);
  }

  /**
   * Adds the other peer's candidate.
   */
  async addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate.candidate) return;
    try {
      await this.#connection.addIceCandidate(candidate);
    } catch {
      // A candidate that arrives after the connection is closed is not worth
      // tearing the call down for.
    }
  }

  /**
   * Mutes or unmutes the microphone.
   */
  setMuted(muted: boolean): void {
    for (const track of this.#localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  /**
   * Whether the microphone is muted.
   */
  get muted(): boolean {
    const tracks = this.#localStream?.getAudioTracks() ?? [];
    return tracks.length > 0 && tracks.every((track) => !track.enabled);
  }

  /**
   * Tears the peer connection down and releases the microphone.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const track of this.#localStream?.getTracks() ?? []) {
      track.stop();
    }
    this.#localStream = null;
    this.#connection.close();
  }
}
