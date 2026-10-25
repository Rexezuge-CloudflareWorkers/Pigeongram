import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CallDto } from '../call-types';
import type { ClientSocketMessage, UpdateEvent } from '../types';
import { acceptCall as acceptCallRpc, confirmCall, discardCall, fetchCallDhConfig, receivedCall, requestCall } from './api';
import { fromBase64, toBase64 } from './base64';
import { CallCipher } from './crypto';
import { createDhKeyPair, validateDhConfig } from './dh';
import type { DhConfig } from './dh';
import { establishKey } from './exchange';
import { messageOf, randomCallId } from './live';
import type { LiveCall } from './live';
import { CallPeerSession } from './peer';
import { callReducer } from './session';
import type { CallView } from './session';

/**
 * What the controller offers the UI.
 */
export interface CallController {
  /**
   * The call the reader is in, or `null` when there is none.
   */
  view: CallView | null;
  /**
   * The other side's audio, once it arrives.
   */
  remoteStream: MediaStream | null;
  /**
   * Starts a call to a chat.
   */
  startCall: (chatId: number) => void;
  /**
   * Answers an incoming call.
   */
  accept: () => void;
  /**
   * Turns an incoming call down.
   */
  decline: () => void;
  /**
   * Ends the call the reader is in.
   */
  hangUp: () => void;
  /**
   * Mutes or unmutes the microphone.
   */
  toggleMute: () => void;
  /**
   * Takes the overlay away after a finished call.
   */
  dismiss: () => void;
  /**
   * Folds a bridge event into the call.
   */
  handleUpdate: (update: UpdateEvent) => void;
}

/**
 * Drives the calls of the account.
 *
 * The controller is the piece that knows the order of a call: the key
 * exchange first, the media connection second, and the signalling in between.
 * Everything it does with the bridge goes through `api.ts`, and everything it
 * does with the media goes through `peer.ts` — this module only decides
 * *when*.
 */
export function useCalls(send: (message: ClientSocketMessage) => void, onError: (failure: unknown) => void): CallController {
  const [view, dispatch] = useReducer(callReducer, null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const live = useRef<LiveCall | null>(null);
  const config = useRef<DhConfig | null>(null);
  const sendRef = useRef(send);
  /**
   * A call is being requested. `live.current` is only assigned after three
   * awaits, so a double-tap lands inside that window; this flag closes it.
   */
  const starting = useRef(false);
  /**
   * `accept` is in flight. Two taps would send two accept RPCs with different
   * gB values, and the second would replace the key the first already used.
   */
  const accepting = useRef(false);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  /**
   * The public parameters of the key exchange.
   *
   * They hardly ever change, so they are kept for the session: every call
   * after the first one skips the round trip and the checks.
   */
  const dhConfig = useCallback(async (): Promise<DhConfig> => {
    if (config.current) return config.current;
    const raw = await fetchCallDhConfig();
    const p = fromBase64(raw.p);
    if (p === null) throw new Error('The Diffie-Hellman prime did not arrive intact');
    const validated = await validateDhConfig({ g: raw.g, p });
    config.current = validated;
    return validated;
  }, []);

  /**
   * Forgets the call and puts the microphone down.
   */
  const teardown = useCallback((): void => {
    live.current?.peer.close();
    live.current = null;
    accepting.current = false;
    setRemoteStream(null);
  }, []);

  /**
   * The call is up: the key is known on both sides and the media connection
   * can be set up.
   *
   * Only the callee derives its key here. The caller's half of the exchange
   * is over when the callee accepts, and the final call carries the caller's
   * *own* public value — deriving from it would compute the wrong key.
   */
  const onActive = useCallback(async (call: CallDto): Promise<void> => {
    const current = live.current;
    if (!current) return;
    if (current.direction === 'incoming' && !current.peer.ready && !current.deriving) {
      if (!current.keyPair || !current.config || !call.gAOrB) {
        throw new Error("The call did not carry the caller's key exchange value");
      }
      // Claim the derivation before the first await: two `active` updates can
      // arrive together, and both would otherwise pass the `ready` check.
      current.deriving = true;
      const peerValue = fromBase64(call.gAOrB);
      if (peerValue === null) throw new Error("The caller's key exchange value did not arrive intact");
      const { key, fingerprint } = await establishKey({
        config: current.config,
        secret: current.keyPair.secret,
        peerValue,
        commitment: current.gAHash,
        expectedFingerprint: call.keyFingerprint,
      });
      current.peer.setCipher(new CallCipher(key, false));
      dispatch({ type: 'fingerprint', callId: current.callId, fingerprint });
    }
    dispatch({ type: 'phase', callId: current.callId, phase: 'connecting' });
    await current.peer.open(call);
    await current.peer.drain();
  }, []);

  /**
   * The other side accepted: the caller's half of the exchange is over.
   */
  const onAccepted = useCallback(
    async (call: CallDto): Promise<void> => {
      const current = live.current;
      if (!current?.keyPair || !current.config || !call.gB) return;
      // The key is derived once: a second "accepted" update must not make
      // the caller confirm the same call twice. Claim it before the await.
      if (current.peer.ready || current.confirmed) return;
      current.confirmed = true;
      const peerValue = fromBase64(call.gB);
      if (peerValue === null) throw new Error("The callee's key exchange value did not arrive intact");
      const { key, fingerprint } = await establishKey({
        config: current.config,
        secret: current.keyPair.secret,
        peerValue,
      });
      current.peer.setCipher(new CallCipher(key, true));
      dispatch({ type: 'fingerprint', callId: current.callId, fingerprint });
      const confirmed = await confirmCall({
        callId: current.callId,
        gA: toBase64(current.keyPair.value),
        keyFingerprint: fingerprint,
      });
      await onActive(confirmed.call);
    },
    [onActive],
  );

  /**
   * A call of the account moved on.
   */
  const onCall = useCallback(
    async (call: CallDto): Promise<void> => {
      const current = live.current;
      if (call.state === 'requested') {
        if (current) return;
        // The reader is being called: the caller is the admin of the call and
        // the other side is the reader.
        const peer = new CallPeerSession(
          call.id,
          'incoming',
          (message) => sendRef.current(message),
          (stream) => setRemoteStream(stream),
          () => dispatch({ type: 'phase', callId: call.id, phase: 'active' }),
          () => {
            dispatch({ type: 'failed', callId: call.id, error: 'The call could not be connected' });
            teardown();
          },
        );
        live.current = {
          callId: call.id,
          chatId: call.adminId,
          peerId: call.adminId,
          direction: 'incoming',
          gAHash: call.gAHash ? fromBase64(call.gAHash) : null,
          config: null,
          keyPair: null,
          deriving: false,
          confirmed: false,
          peer,
          startedAt: Date.now(),
        };
        dispatch({ type: 'incoming', callId: call.id, chatId: call.adminId, peerId: call.adminId });
        // The server now knows that somebody is at the phone, so it stops
        // offering the call to anyone else.
        void receivedCall(call.id).catch(() => {});
        return;
      }
      if (!current || current.callId !== call.id) return;
      try {
        if (call.state === 'accepted' && current.direction === 'outgoing') {
          await onAccepted(call);
          return;
        }
        if (call.state === 'active') {
          await onActive(call);
          return;
        }
        if (call.state === 'discarded') {
          dispatch({ type: 'ended', callId: call.id });
          teardown();
        }
      } catch (error) {
        dispatch({ type: 'failed', callId: call.id, error: messageOf(error) });
        teardown();
      }
    },
    [onAccepted, onActive, teardown],
  );

  const handleUpdate = useCallback(
    (update: UpdateEvent): void => {
      if (update.type === 'call') {
        void onCall(update.call);
        return;
      }
      if (update.type === 'call_signaling') {
        void live.current?.peer.receive(update.callId, update.data);
      }
    },
    [onCall],
  );

  const startCall = useCallback(
    (chatId: number): void => {
      if (live.current) return;
      if (starting.current) {
        // The overlay does not exist yet, so the failure has nowhere to
        // render: report it through the app's banner.
        onError(new Error('A call is already in progress'));
        return;
      }
      starting.current = true;
      void (async () => {
        try {
          const parameters = await dhConfig();
          const keyPair = await createDhKeyPair(parameters);
          const result = await requestCall({
            chatId,
            gAHash: toBase64(keyPair.hash),
            randomId: randomCallId(),
          });
          const peer = new CallPeerSession(
            result.call.id,
            'outgoing',
            (message) => sendRef.current(message),
            (stream) => setRemoteStream(stream),
            () => dispatch({ type: 'phase', callId: result.call.id, phase: 'active' }),
            () => {
              dispatch({ type: 'failed', callId: result.call.id, error: 'The call could not be connected' });
              teardown();
            },
          );
          live.current = {
            callId: result.call.id,
            chatId,
            peerId: chatId,
            direction: 'outgoing',
            gAHash: null,
            config: parameters,
            keyPair,
            deriving: false,
            confirmed: false,
            peer,
            startedAt: Date.now(),
          };
          dispatch({ type: 'outgoing', callId: result.call.id, chatId, peerId: chatId });
        } catch (error) {
          // The call never started, so there is no overlay to show the failure
          // on: the app reports it.
          onError(error);
        } finally {
          starting.current = false;
        }
      })();
    },
    [dhConfig, onError],
  );

  const accept = useCallback((): void => {
    if (accepting.current) return;
    const current = live.current;
    if (!current || current.direction !== 'incoming' || current.keyPair) return;
    accepting.current = true;
    void (async () => {
      try {
        const parameters = await dhConfig();
        const keyPair = await createDhKeyPair(parameters);
        current.config = parameters;
        current.keyPair = keyPair;
        await acceptCallRpc({ callId: current.callId, gB: toBase64(keyPair.value) });
        dispatch({ type: 'phase', callId: current.callId, phase: 'connecting' });
      } catch (error) {
        dispatch({ type: 'failed', callId: current.callId, error: messageOf(error) });
        teardown();
      } finally {
        accepting.current = false;
      }
    })();
  }, [dhConfig, teardown]);

  const decline = useCallback((): void => {
    const current = live.current;
    if (!current) return;
    void discardCall({ callId: current.callId, reason: 'missed', duration: 0 }).catch(() => {});
    dispatch({ type: 'ended', callId: current.callId });
    teardown();
  }, [teardown]);

  const hangUp = useCallback((): void => {
    const current = live.current;
    if (!current) return;
    const duration = Math.max(0, Math.round((Date.now() - current.startedAt) / 1000));
    void discardCall({ callId: current.callId, reason: 'hangup', duration }).catch(() => {});
    dispatch({ type: 'ended', callId: current.callId });
    teardown();
  }, [teardown]);

  const toggleMute = useCallback((): void => {
    const current = live.current;
    if (!current) return;
    const muted = !current.peer.muted;
    current.peer.setMuted(muted);
    dispatch({ type: 'muted', callId: current.callId, muted });
  }, []);

  const dismiss = useCallback((): void => {
    dispatch({ type: 'dismissed' });
  }, []);

  useEffect(() => teardown, [teardown]);

  return {
    view,
    remoteStream,
    startCall,
    accept,
    decline,
    hangUp,
    toggleMute,
    dismiss,
    handleUpdate,
  };
}
