import { rpc } from '../api';
import type {
  AcceptCallParams,
  CallResult,
  ConfirmCallParams,
  DiscardCallParams,
  GetCallDhConfigResult,
  RateCallParams,
  RequestCallParams,
} from '../call-types';

/**
 * The calls half of the bridge client.
 *
 * The calls live in their own module because they are the one part of the
 * bridge that carries something other than chat data: the Diffie-Hellman
 * parameters and the signalling packets are opaque bytes that belong to the
 * two peers.
 *
 * The shared key never comes through here — the exchange runs in the page.
 */

/**
 * The public parameters of the call's key exchange.
 *
 * The prime and the generator are public, so they may travel through the
 * bridge — but the exchange itself may not: the shared key belongs to the
 * two peers, and the page keeps it.
 */
export const fetchCallDhConfig = (): Promise<GetCallDhConfigResult> => rpc('getCallDhConfig');

/**
 * Asks a peer for a call.
 *
 * The commitment is the hash of the caller's public Diffie-Hellman value; the
 * random id is the caller's own, so a retry is the same call and not a
 * second one.
 */
export const requestCall = (params: RequestCallParams): Promise<CallResult> => rpc('requestCall', { ...params });

/**
 * Tells the server that the reader is at the phone and ready to take calls.
 */
export const receivedCall = (callId: string): Promise<{ ok: true }> => rpc('receivedCall', { callId });

/**
 * Answers a call with the callee's own public Diffie-Hellman value.
 */
export const acceptCall = (params: AcceptCallParams): Promise<CallResult> => rpc('acceptCall', { ...params });

/**
 * Confirms a call with the caller's public value and the key's fingerprint.
 */
export const confirmCall = (params: ConfirmCallParams): Promise<CallResult> => rpc('confirmCall', { ...params });

/**
 * Ends a call.
 */
export const discardCall = (params: DiscardCallParams): Promise<{ ok: true }> => rpc('discardCall', { ...params });

/**
 * Rates a finished call.
 */
export const rateCall = (params: RateCallParams): Promise<{ ok: true }> => rpc('rateCall', { ...params });
