/**
 * The payload format of the signalling channel.
 *
 * The signalling channel carries the WebRTC handshake between the two peers:
 * the session description and the ICE candidates. Telegram's server relays
 * the packets without reading them, so the format inside is the two clients'
 * own business — and this is where this client's format lives.
 *
 * It is deliberately plain: a version byte and a JSON body. The packets are
 * already opaque to everything but the two peers, so there is nothing to
 * gain from a binary encoding, and a JSON body is readable in a debugger.
 */

import { concat } from './hash';

/**
 * The version of the payload format.
 *
 * A peer that does not know the version says so instead of guessing.
 */
export const SIGNAL_VERSION = 1;

/**
 * One message of the signalling channel.
 */
export type SignalMessage =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; mid: string | null; index: number; candidate: string }
  | { kind: 'end' };

/**
 * Encodes a signalling message.
 */
export function encodeSignal(message: SignalMessage): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message));
  return concat(new Uint8Array([SIGNAL_VERSION]), body);
}

/**
 * Decodes a signalling message, or returns `null` when the packet is not one.
 */
export function decodeSignal(bytes: Uint8Array): SignalMessage | null {
  if (bytes.length < 2 || bytes[0] !== SIGNAL_VERSION) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as unknown;
    return isSignalMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether a decoded value is a signalling message.
 */
function isSignalMessage(value: unknown): value is SignalMessage {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'offer' || kind === 'answer') {
    return typeof (value as { sdp?: unknown }).sdp === 'string';
  }
  if (kind === 'candidate') {
    const candidate = value as { mid?: unknown; index?: unknown; candidate?: unknown };
    return (
      (candidate.mid === null || typeof candidate.mid === 'string') &&
      typeof candidate.index === 'number' &&
      typeof candidate.candidate === 'string'
    );
  }
  return kind === 'end';
}
