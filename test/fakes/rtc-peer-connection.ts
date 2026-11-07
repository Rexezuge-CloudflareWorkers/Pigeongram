// Shared fake for RTCPeerConnection used by the calls tests.
// Scriptable offer/answer/ICE states; no real networking.

export interface FakeRTCSessionDescriptionInit {
  type: RTCSdpType;
  sdp: string;
}

export class FakeRTCPeerConnection {
  public signalingState: RTCSignalingState = 'stable';
  public iceConnectionState: RTCIceConnectionState = 'new';
  public connectionState: RTCPeerConnectionState = 'new';

  public localDescription: RTCSessionDescription | null = null;
  public remoteDescription: RTCSessionDescription | null = null;

  private readonly iceCandidates: RTCIceCandidateInit[] = [];
  public onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
  public ontrack: ((ev: RTCTrackEvent) => void) | null = null;
  public onconnectionstatechange: (() => void) | null = null;

  public createOffer = async (): Promise<RTCSessionDescriptionInit> => {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  };

  public createAnswer = async (): Promise<RTCSessionDescriptionInit> => {
    return { type: 'answer', sdp: 'fake-answer-sdp' };
  };

  public setLocalDescription = async (desc?: RTCSessionDescriptionInit): Promise<void> => {
    this.localDescription = desc ? new RTCSessionDescription(desc) : null;
    if (desc?.type === 'offer') this.signalingState = 'have-local-offer';
    if (desc?.type === 'answer') this.signalingState = 'stable';
  };

  public setRemoteDescription = async (desc: RTCSessionDescriptionInit): Promise<void> => {
    this.remoteDescription = new RTCSessionDescription(desc);
    if (desc.type === 'offer') this.signalingState = 'have-remote-offer';
    if (desc.type === 'answer') this.signalingState = 'stable';
  };

  public addIceCandidate = async (candidate?: RTCIceCandidateInit | null): Promise<void> => {
    if (candidate) this.iceCandidates.push(candidate);
  };

  public addTrack = (_track: MediaStreamTrack, ..._streams: MediaStream[]): RTCRtpSender => {
    return {} as RTCRtpSender;
  };

  public close = (): void => {
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
  };

  public emitIceCandidate(candidate: RTCIceCandidateInit | null): void {
    this.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent);
  }

  public setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

export function installFakeRTCPeerConnection(): void {
  (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakeRTCPeerConnection as unknown as typeof RTCPeerConnection;
}
