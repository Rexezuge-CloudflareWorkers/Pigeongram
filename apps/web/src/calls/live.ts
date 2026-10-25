import type { DhConfig, DhKeyPair } from './dh';
import type { CallPeerSession } from './peer';

/**
 * The live half of a call: everything that must not be in the React state.
 *
 * The keys live here and nowhere else — the shared key is a secret, and a
 * secret in a component's state is a secret in the browser's dev tools, in a
 * crash report and in a screenshot of the DOM.
 */
export interface LiveCall {
  callId: string;
  chatId: number;
  peerId: number;
  direction: 'outgoing' | 'incoming';
  /**
   * The commitment the caller sent, so the callee can check the caller's
   * public value against it once the key is derived.
   */
  gAHash: Uint8Array | null;
  config: DhConfig | null;
  keyPair: DhKeyPair | null;
  /**
   * Whether the key is being derived. Set before the first await so two
   * updates arriving together cannot derive it twice.
   */
  deriving: boolean;
  /**
   * Whether the caller has confirmed the key. A second "accepted" update must
   * not confirm the same call again.
   */
  confirmed: boolean;
  peer: CallPeerSession;
  startedAt: number;
}

/**
 * A random id for a call request.
 *
 * Telegram's is a 32-bit integer and the client picks it, so a retry of the
 * same request is the same call and not a second one.
 */
export function randomCallId(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(value === 0 ? 1 : value);
}

/**
 * The message of a failure, in the reader's words where possible.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The call could not be set up';
}
