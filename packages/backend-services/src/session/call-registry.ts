import type { tl } from '@mtcute/core';
import { EngineError } from './errors';
import { callAccessHash } from './call-dto';

/**
 * The calls the engine knows about.
 *
 * A call is addressed by its id and an access hash, and the access hash is
 * the one thing the browser must not carry: the bridge's rule is that peers
 * are resolved server-side, and a call is a peer. So the engine remembers the
 * hash of every call it sees and hands it back when a method needs to
 * address the call.
 *
 * The registry lives in memory, which is enough: a call only exists while the
 * session is live, and the session is live exactly while a browser is
 * attached.
 */
export class CallRegistry {
  readonly #accessHashes = new Map<string, string>();

  /**
   * Remembers a call's access hash.
   *
   * The discarded constructor carries none, and a call that was never
   * addressed cannot be remembered — so the map is left alone for it.
   */
  remember(call: tl.TypePhoneCall): void {
    const accessHash = callAccessHash(call);
    if (accessHash === null) return;
    this.#accessHashes.set(call.id.toString(), accessHash);
  }

  /**
   * The access hash of a call the engine knows.
   *
   * A call the engine has never seen is a call the browser made up, and the
   * bridge answers that with a 404 rather than passing a nonsense peer to
   * Telegram.
   */
  accessHash(callId: string): string {
    const accessHash = this.#accessHashes.get(callId);
    if (accessHash === undefined) {
      throw new EngineError(`Unknown call: ${callId}`, 404);
    }
    return accessHash;
  }

  /**
   * Whether a call is known.
   */
  knows(callId: string): boolean {
    return this.#accessHashes.has(callId);
  }

  /**
   * Forgets a call. A discarded call is over, and its hash is of no use to
   * anything that comes after it.
   */
  forget(callId: string): void {
    this.#accessHashes.delete(callId);
  }

  /**
   * Forgets every call — the account signed out, and the ids mean nothing to
   * whoever signs in next.
   */
  clear(): void {
    this.#accessHashes.clear();
  }
}
