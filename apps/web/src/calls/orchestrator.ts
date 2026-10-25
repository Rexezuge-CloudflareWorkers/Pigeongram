import type { CallDto } from '../call-types';
import type { UpdateEvent } from '../types';
import * as callRpc from './api';
import { fromBase64, toBase64 } from './base64';
import { CallCipher } from './crypto';
import { createDhKeyPair, validateDhConfig } from './dh';
import type { DhConfig } from './dh';
import { establishKey } from './exchange';
import { messageOf, randomCallId } from './live';
import type { LiveCall } from './live';
import { defaultPeer } from './orchestrator-ports';
import type { CallOrchestratorOptions, CallRpcPort, CreateCallPeer } from './orchestrator-ports';

export type { CallOrchestratorOptions, CallPeerPort, CallRpcPort, CreateCallPeer } from './orchestrator-ports';

/**
 * The order of a call.
 *
 * The key exchange comes first, the media connection second, and the
 * signalling in between. Everything the bridge does goes through `CallRpcPort`
 * and everything the media does through `CreateCallPeer`; this class only
 * decides *when*. It keeps the live record and the guard flags that close the
 * windows between the awaits — the parts that must not live in React state or
 * in a render.
 */
export class CallOrchestrator {
  readonly #dispatch: CallOrchestratorOptions['dispatch'];
  readonly #setRemoteStream: CallOrchestratorOptions['setRemoteStream'];
  #onError: CallOrchestratorOptions['onError'];
  #send: CallOrchestratorOptions['send'];
  readonly #rpc: CallRpcPort;
  readonly #createPeer: CreateCallPeer;
  readonly #now: () => number;

  #live: LiveCall | null = null;
  #config: DhConfig | null = null;
  #disposed = false;

  /**
   * A call is being requested. The live record only exists after three awaits,
   * so a double tap lands inside that window; this flag closes it.
   */
  #starting = false;

  /**
   * The call id whose accept is in flight. Two taps would send two accept RPCs
   * with different gB values, and the second would replace the key the first
   * already used. Scoped by id so a late `finally` cannot unlock a newer call.
   */
  #accepting: string | null = null;

  constructor(options: CallOrchestratorOptions) {
    this.#dispatch = options.dispatch;
    this.#setRemoteStream = options.setRemoteStream;
    this.#onError = options.onError;
    this.#send = options.send;
    this.#rpc = options.rpc ?? callRpc;
    this.#createPeer = options.createPeer ?? defaultPeer;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Starts a call to a chat. A second call is refused: the overlay is a
   * singleton, and the live record belongs to the conversation that started
   * first.
   */
  readonly startCall = (chatId: number): void => {
    if (this.#disposed || this.#live) return;
    if (this.#starting) {
      // The overlay does not exist yet, so the failure has nowhere to
      // render: report it through the app's banner.
      this.#onError(new Error('A call is already in progress'));
      return;
    }
    this.#starting = true;
    void (async () => {
      try {
        const parameters = await this.#dhConfig();
        const keyPair = await createDhKeyPair(parameters);
        const result = await this.#rpc.requestCall({
          chatId,
          gAHash: toBase64(keyPair.hash),
          randomId: randomCallId(),
        });
        if (this.#disposed) {
          // The page went away while the request was in flight. Nobody would
          // answer an overlay that no longer exists, so drop the call.
          void this.#discard(result.call.id, 'hangup', 0);
          return;
        }
        const live = this.#newLive({
          callId: result.call.id,
          chatId,
          peerId: chatId,
          direction: 'outgoing',
          gAHash: null,
          config: parameters,
          keyPair,
          startedAt: this.#now(),
        });
        this.#live = live;
        this.#dispatch({ type: 'outgoing', callId: live.callId, chatId, peerId: chatId });
      } catch (error) {
        // The call never started, so there is no overlay to show the failure
        // on: the app reports it.
        if (!this.#disposed) this.#onError(error);
      } finally {
        this.#starting = false;
      }
    })();
  };

  /**
   * Answers an incoming call.
   */
  readonly accept = (): void => {
    if (this.#disposed || this.#accepting !== null) return;
    const current = this.#live;
    if (!current || current.direction !== 'incoming' || current.keyPair) return;
    this.#accepting = current.callId;
    void (async () => {
      try {
        const parameters = await this.#dhConfig();
        if (this.#live !== current) return;
        const keyPair = await createDhKeyPair(parameters);
        if (this.#live !== current) return;
        current.config = parameters;
        current.keyPair = keyPair;
        await this.#rpc.acceptCall({ callId: current.callId, gB: toBase64(keyPair.value) });
        if (this.#live !== current) return;
        this.#dispatch({ type: 'phase', callId: current.callId, phase: 'connecting' });
      } catch (error) {
        if (this.#live !== current) return;
        this.#dispatch({ type: 'failed', callId: current.callId, error: messageOf(error) });
        this.#teardown();
      } finally {
        if (this.#accepting === current.callId) this.#accepting = null;
      }
    })();
  };

  /**
   * Turns an incoming call down.
   */
  readonly decline = (): void => {
    const current = this.#live;
    if (!current) return;
    void this.#discard(current.callId, 'missed', 0);
    this.#dispatch({ type: 'ended', callId: current.callId });
    this.#teardown();
  };

  /**
   * Ends the call the reader is in.
   */
  readonly hangUp = (): void => {
    const current = this.#live;
    if (!current) return;
    const duration = Math.max(0, Math.round((this.#now() - current.startedAt) / 1000));
    void this.#discard(current.callId, 'hangup', duration);
    this.#dispatch({ type: 'ended', callId: current.callId });
    this.#teardown();
  };

  /**
   * Mutes or unmutes the microphone.
   */
  readonly toggleMute = (): void => {
    const current = this.#live;
    if (!current) return;
    const muted = !current.peer.muted;
    current.peer.setMuted(muted);
    this.#dispatch({ type: 'muted', callId: current.callId, muted });
  };

  /**
   * Folds a bridge event into the call.
   */
  readonly handleUpdate = (update: UpdateEvent): void => {
    if (this.#disposed) return;
    if (update.type === 'call') {
      void this.#onCall(update.call);
      return;
    }
    if (update.type === 'call_signaling') {
      void this.#live?.peer.receive(update.callId, update.data);
    }
  };

  /**
   * Keeps the bridge callbacks current without rebuilding the live call: the
   * socket's send function and the app's error banner can both change while a
   * call is up.
   */
  setHandlers(handlers: { send: CallOrchestratorOptions['send']; onError: CallOrchestratorOptions['onError'] }): void {
    this.#send = handlers.send;
    this.#onError = handlers.onError;
  }

  /**
   * Releases the media plane without moving the view. The hook calls this
   * when the page unmounts; a call still up is not ended on the server, which
   * matches the old unmount behaviour.
   */
  dispose(): void {
    this.#disposed = true;
    this.#teardown();
  }

  /**
   * The public parameters of the key exchange.
   *
   * They hardly ever change, so they are kept for the session: every call
   * after the first one skips the round trip and the checks.
   */
  async #dhConfig(): Promise<DhConfig> {
    if (this.#config) return this.#config;
    const raw = await this.#rpc.fetchCallDhConfig();
    const p = fromBase64(raw.p);
    if (p === null) throw new Error('The Diffie-Hellman prime did not arrive intact');
    const validated = await validateDhConfig({ g: raw.g, p });
    this.#config = validated;
    return validated;
  }

  /**
   * Builds the live record and its media plane for one call.
   */
  #newLive(input: Omit<LiveCall, 'peer' | 'deriving' | 'confirmed'>): LiveCall {
    const { callId, direction } = input;
    const peer = this.#createPeer({
      callId,
      direction,
      send: (message) => this.#send(message),
      onStream: (stream) => this.#setRemoteStream(stream),
      onConnected: () => this.#dispatch({ type: 'phase', callId, phase: 'active' }),
      onFailed: () => {
        this.#dispatch({ type: 'failed', callId, error: 'The call could not be connected' });
        this.#teardown();
      },
    });
    return { ...input, peer, deriving: false, confirmed: false };
  }

  /**
   * Forgets the call and puts the microphone down.
   */
  #teardown(): void {
    this.#live?.peer.close();
    this.#live = null;
    this.#accepting = null;
    this.#setRemoteStream(null);
  }

  /**
   * Ends a call on the server, best effort: a call that is already gone is
   * not an error the reader needs to see.
   */
  async #discard(callId: string, reason: 'hangup' | 'missed', duration: number): Promise<void> {
    try {
      await this.#rpc.discardCall({ callId, reason, duration });
    } catch {
      // The call is over locally either way.
    }
  }

  /**
   * A call of the account moved on.
   */
  async #onCall(call: CallDto): Promise<void> {
    if (call.state === 'requested') {
      if (this.#disposed || this.#live) return;
      // The reader is being called: the caller is the admin of the call and
      // the other side is the reader.
      const live = this.#newLive({
        callId: call.id,
        chatId: call.adminId,
        peerId: call.adminId,
        direction: 'incoming',
        gAHash: call.gAHash ? fromBase64(call.gAHash) : null,
        config: null,
        keyPair: null,
        startedAt: this.#now(),
      });
      this.#live = live;
      this.#dispatch({ type: 'incoming', callId: live.callId, chatId: call.adminId, peerId: call.adminId });
      // The server now knows that somebody is at the phone, so it stops
      // offering the call to anyone else.
      void this.#rpc.receivedCall(call.id).catch(() => {});
      return;
    }

    const current = this.#live;
    if (!current || current.callId !== call.id) return;
    try {
      if (call.state === 'accepted' && current.direction === 'outgoing') {
        await this.#onAccepted(call, current);
        return;
      }
      if (call.state === 'active') {
        await this.#onActive(call, current);
        return;
      }
      if (call.state === 'discarded') {
        this.#dispatch({ type: 'ended', callId: call.id });
        this.#teardown();
      }
    } catch (error) {
      if (this.#live !== current) return;
      this.#dispatch({ type: 'failed', callId: call.id, error: messageOf(error) });
      this.#teardown();
    }
  }

  /**
   * The other side accepted: the caller's half of the exchange is over.
   */
  async #onAccepted(call: CallDto, current: LiveCall): Promise<void> {
    if (!current.keyPair || !current.config || !call.gB) return;
    // The key is derived once: a second "accepted" update must not make the
    // caller confirm the same call twice. Claim it before the await.
    if (current.peer.ready || current.confirmed) return;
    current.confirmed = true;
    const peerValue = fromBase64(call.gB);
    if (peerValue === null) throw new Error("The callee's key exchange value did not arrive intact");
    const { key, fingerprint } = await establishKey({
      config: current.config,
      secret: current.keyPair.secret,
      peerValue,
    });
    if (this.#live !== current) return;
    current.peer.setCipher(new CallCipher(key, true));
    this.#dispatch({ type: 'fingerprint', callId: current.callId, fingerprint });
    const confirmed = await this.#rpc.confirmCall({
      callId: current.callId,
      gA: toBase64(current.keyPair.value),
      keyFingerprint: fingerprint,
    });
    if (this.#live !== current) return;
    await this.#onActive(confirmed.call, current);
  }

  /**
   * The call is up: the key is known on both sides and the media connection
   * can be set up.
   *
   * Only the callee derives its key here. The caller's half of the exchange
   * is over when the callee accepts, and the final call carries the caller's
   * *own* public value — deriving from it would compute the wrong key.
   */
  async #onActive(call: CallDto, current: LiveCall): Promise<void> {
    if (this.#live !== current) return;
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
      if (this.#live !== current) return;
      current.peer.setCipher(new CallCipher(key, false));
      this.#dispatch({ type: 'fingerprint', callId: current.callId, fingerprint });
    }
    if (this.#live !== current) return;
    this.#dispatch({ type: 'phase', callId: current.callId, phase: 'connecting' });
    await current.peer.open(call);
    if (this.#live !== current) return;
    await current.peer.drain();
  }
}
