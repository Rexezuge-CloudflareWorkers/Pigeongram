/**
 * The contract half of the calls surface: the DTO a call carries and the
 * shapes of the bridge methods that drive one.
 *
 * Kept out of `types.ts` and `rpc-types.ts` so both stay under the god-file
 * cap, and mirrored in the SPA (`apps/web/src/call-types.ts`) the same way the
 * other contract modules are.
 *
 * Two conventions run through the whole surface:
 *
 * - **Bytes travel as base64.** The Diffie-Hellman values are 256-byte
 *   numbers and the signalling packets are opaque, so JSON cannot hold them.
 * - **64-bit ids travel as decimal strings.** A call id and a key
 *   fingerprint are `long`s, and a JavaScript number cannot hold them.
 *
 * The call's access hash never crosses the bridge: the engine keeps it, and
 * the browser only ever names a call by its id. That keeps the "peers are
 * resolved server-side" rule of the bridge intact for calls too.
 */

import type { PeerId } from './types';

/**
 * Where a call stands.
 *
 * The names follow Telegram's own constructors, so the mapping from the wire
 * to the UI is one word and no interpretation.
 */
export type CallState = 'empty' | 'waiting' | 'requested' | 'accepted' | 'active' | 'discarded';

/**
 * The call protocols the local build speaks.
 *
 * `libraryVersions` is the ordered list of tgcalls versions this client
 * supports — the preferred one first. The server merges the two peers' lists
 * and settles on the best common one.
 */
export interface CallProtocolDto {
  udpP2p: boolean;
  udpReflector: boolean;
  minLayer: number;
  maxLayer: number;
  libraryVersions: string[];
}

/**
 * One way into the call's media: a TURN/STUN endpoint, or a legacy UDP/TCP
 * relay.
 *
 * Only the WebRTC entries are usable from a browser — a page cannot open the
 * raw UDP socket the classic transport needs — but the legacy ones are carried
 * so the UI can say why a peer is unreachable.
 */
export interface CallConnectionDto {
  id: string;
  ip: string;
  ipv6: string;
  port: number;
  turn: boolean;
  stun: boolean;
  username: string;
  password: string;
  tcp: boolean;
  /**
   * The classic transport's relay tag, base64. Empty for a WebRTC endpoint.
   */
  peerTag: string;
}

/**
 * A call, as the bridge serves it.
 */
export interface CallDto {
  id: string;
  /**
   * When the call was created, in unix seconds.
   */
  date: number;
  /**
   * When the call was answered, in unix seconds.
   */
  startDate?: number;
  /**
   * The user who started the call.
   */
  adminId: number;
  /**
   * The other participant.
   */
  participantId: number;
  /**
   * Whether the call carries (or was asked for) a video stream.
   */
  video: boolean;
  p2pAllowed: boolean;
  conferenceSupported: boolean;
  state: CallState;
  /**
   * The caller's commitment to the key exchange, base64. Present while the
   * call is being requested.
   */
  gAHash?: string;
  /**
   * The callee's key exchange value, base64. Present once the call is
   * accepted.
   */
  gB?: string;
  /**
   * The caller's key exchange value, base64. Present in the final call.
   */
  gAOrB?: string;
  /**
   * The lower 64 bits of SHA1 over the shared key, as a decimal string.
   */
  keyFingerprint?: string;
  protocol: CallProtocolDto;
  connections: CallConnectionDto[];
  /**
   * Why the call ended, when it did.
   */
  discardReason?: string;
  /**
   * Whether Telegram asks for a rating when the call ends.
   */
  needRating?: boolean;
  /**
   * How long the call ran, in seconds.
   */
  duration?: number;
}

/**
 * The methods the calls half of the bridge exposes.
 *
 * All of them are writes: they change the state of a call, so none of them
 * may ride the read-only `batch`.
 */
export type CallRpcMethod = 'getCallDhConfig' | 'requestCall' | 'receivedCall' | 'acceptCall' | 'confirmCall' | 'discardCall' | 'rateCall';

export interface GetCallDhConfigResult {
  /**
   * The Diffie-Hellman generator.
   */
  g: number;
  /**
   * The 2048-bit prime, base64.
   */
  p: string;
  /**
   * The config's version, to be sent back on the next read.
   */
  version: number;
}

export interface RequestCallParams {
  chatId: PeerId;
  /**
   * SHA256 over the caller's Diffie-Hellman value, base64.
   */
  gAHash: string;
  /**
   * The client's own random id, so a retry is not a second call.
   */
  randomId: string;
}

export interface ReceivedCallParams {
  callId: string;
}

export interface AcceptCallParams {
  callId: string;
  /**
   * The callee's Diffie-Hellman value, base64.
   */
  gB: string;
}

export interface ConfirmCallParams {
  callId: string;
  /**
   * The caller's Diffie-Hellman value, base64.
   */
  gA: string;
  /**
   * The lower 64 bits of SHA1 over the shared key, as a decimal string.
   */
  keyFingerprint: string;
}

/**
 * Why a call ended.
 *
 * The names are the friendly half of Telegram's `phoneCallDiscardReason`
 * constructors; the engine maps them onto the wire.
 */
export type CallDiscardReason = 'missed' | 'disconnect' | 'hangup' | 'busy';

export interface DiscardCallParams {
  callId: string;
  reason: CallDiscardReason;
  /**
   * How long the call ran, in seconds.
   */
  duration: number;
  /**
   * Whether a video stream was enabled at any point.
   */
  video?: boolean;
}

export interface RateCallParams {
  callId: string;
  /**
   * A score from 1 to 5.
   */
  rating: number;
  /**
   * The user's own words, and the problem hashtags.
   */
  comment?: string;
}

export interface CallResult {
  call: CallDto;
}
