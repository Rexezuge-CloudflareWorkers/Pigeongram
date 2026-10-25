import type { ClientSocketMessage } from '../types';
import * as callRpc from './api';
import { CallPeerSession } from './peer';
import type { CallAction } from './session';

/**
 * The ports the call orchestrator drives.
 *
 * Kept apart from the machine itself so the ordering rules read as rules: the
 * class decides *when*, and these interfaces say what it may reach.
 */

/**
 * The calls half of the bridge, as the orchestrator sees it.
 *
 * Injected so the ordering rules can be driven without a network; production
 * passes `api.ts` itself.
 */
export interface CallRpcPort {
  fetchCallDhConfig: typeof callRpc.fetchCallDhConfig;
  requestCall: typeof callRpc.requestCall;
  receivedCall: typeof callRpc.receivedCall;
  acceptCall: typeof callRpc.acceptCall;
  confirmCall: typeof callRpc.confirmCall;
  discardCall: typeof callRpc.discardCall;
}

/**
 * What the orchestrator needs to build the media plane of one call.
 */
export interface CallPeerPort {
  callId: string;
  direction: 'outgoing' | 'incoming';
  send: (message: ClientSocketMessage) => void;
  onStream: (stream: MediaStream) => void;
  onConnected: () => void;
  onFailed: () => void;
}

/**
 * The factory the orchestrator builds each call's media plane with.
 */
export type CreateCallPeer = (port: CallPeerPort) => CallPeerSession;

/**
 * The non-React collaborators of the call machine.
 *
 * `dispatch`, `setRemoteStream` and `onError` are the bridge to the hook:
 * the orchestrator owns the live call and its guards, the hook owns the view.
 */
export interface CallOrchestratorOptions {
  dispatch: (action: CallAction) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  onError: (failure: unknown) => void;
  send: (message: ClientSocketMessage) => void;
  rpc?: CallRpcPort;
  createPeer?: CreateCallPeer;
  now?: () => number;
}

export const defaultPeer: CreateCallPeer = ({ callId, direction, send, onStream, onConnected, onFailed }) =>
  new CallPeerSession(callId, direction, send, onStream, onConnected, onFailed);
