/**
 * The state of the call the reader is in.
 *
 * This module is the pure half of the call controller: it holds no
 * connections, no keys and no timers, only the state machine the UI renders.
 * Everything that needs the network lives in `controller.ts`, and everything
 * that needs the key lives beside it.
 */

/**
 * Where the call stands.
 *
 * - `ringing` — the call is not answered yet: an outgoing call waits for the
 *   other side to pick up, an incoming one rings at the reader.
 * - `connecting` — the key exchange is over and the two peers are setting the
 *   media connection up.
 * - `active` — the media flows.
 * - `ended` — the call is over; the overlay says so and then goes away.
 */
export type CallPhase = 'ringing' | 'connecting' | 'active' | 'ended';

/**
 * Which way the call went.
 */
export type CallDirection = 'outgoing' | 'incoming';

/**
 * What the UI shows.
 */
export interface CallView {
  /**
   * The call's id, as its decimal string.
   */
  callId: string;
  /**
   * The chat the call belongs to, as its marked peer id.
   */
  chatId: number;
  /**
   * The other side's user id.
   */
  peerId: number;
  direction: CallDirection;
  phase: CallPhase;
  /**
   * Whether the microphone is muted.
   */
  muted: boolean;
  /**
   * The key's fingerprint, once the exchange is over. It is what the two
   * sides compare to be sure they share the same key.
   */
  fingerprint: string | null;
  /**
   * Why the call failed, when it did.
   */
  error: string | null;
  /**
   * When the call started, in unix milliseconds.
   */
  startedAt: number;
}

/**
 * Everything that moves the state machine.
 */
export type CallAction =
  | { type: 'outgoing'; callId: string; chatId: number; peerId: number }
  | { type: 'incoming'; callId: string; chatId: number; peerId: number }
  | { type: 'phase'; callId: string; phase: CallPhase }
  | { type: 'fingerprint'; callId: string; fingerprint: string }
  | { type: 'muted'; callId: string; muted: boolean }
  | { type: 'failed'; callId: string; error: string }
  | { type: 'ended'; callId: string }
  | { type: 'dismissed' };

/**
 * The call state machine.
 *
 * An action about another call is ignored: the updates stream carries every
 * call of the account, and only the one the reader is in matters.
 */
export function callReducer(view: CallView | null, action: CallAction): CallView | null {
  switch (action.type) {
    case 'outgoing': {
      return {
        callId: action.callId,
        chatId: action.chatId,
        peerId: action.peerId,
        direction: 'outgoing',
        phase: 'ringing',
        muted: false,
        fingerprint: null,
        error: null,
        startedAt: Date.now(),
      };
    }
    case 'incoming': {
      return {
        callId: action.callId,
        chatId: action.chatId,
        peerId: action.peerId,
        direction: 'incoming',
        phase: 'ringing',
        muted: false,
        fingerprint: null,
        error: null,
        startedAt: Date.now(),
      };
    }
    case 'phase': {
      if (!view || view.callId !== action.callId) return view;
      return { ...view, phase: action.phase };
    }
    case 'fingerprint': {
      if (!view || view.callId !== action.callId) return view;
      return { ...view, fingerprint: action.fingerprint };
    }
    case 'muted': {
      if (!view || view.callId !== action.callId) return view;
      return { ...view, muted: action.muted };
    }
    case 'failed': {
      if (!view || view.callId !== action.callId) return view;
      return { ...view, phase: 'ended', error: action.error };
    }
    case 'ended': {
      if (!view || view.callId !== action.callId) return view;
      return { ...view, phase: 'ended' };
    }
    case 'dismissed': {
      return null;
    }
    default: {
      return view;
    }
  }
}
