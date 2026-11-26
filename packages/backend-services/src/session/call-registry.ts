import type { tl } from '@mtcute/core';
import { EngineError } from './errors';
import { callAccessHash } from './call-dto';

/**
How many call hashes a live isolate keeps.

A call is remembered until it is discarded, but that discard is not
guaranteed to arrive (a browser can disappear mid-call). An LRU bound keeps
a long-lived isolate from accumulating every call the account has ever seen.
*/
const MAX_CALLS = 64;

/**
The calls the engine knows about.

A call is addressed by its id and an access hash, and the access hash is
the one thing the browser must not carry: the bridge's rule is that peers
are resolved server-side, and a call is a peer. So the engine remembers the
hash of every call it sees and hands it back when a method needs to
address the call.

The registry lives in memory, which is enough: a call only exists while the
session is live, and the session is live exactly while a browser is
attached.
*/
export class CallRegistry {
  readonly #accessHashes = new Map<string, string>();

  /**
  Remembers a call's access hash.
  
  The discarded constructor carries none, and a call that was never
  addressed cannot be remembered — so the map is left alone for it.
  */
  remember(call: tl.TypePhoneCall): void {
    const accessHash = callAccessHash(call);
    if (accessHash === null) return;
    const key = call.id.toString();
    // Map iteration order is insertion order, so the first key is the least
    // recently used one. Re-inserting an existing key refreshes its position.
    this.#accessHashes.delete(key);
    if (this.#accessHashes.size >= MAX_CALLS) {
      const oldest = this.#accessHashes.keys().next();
      if (!oldest.done) this.#accessHashes.delete(oldest.value);
    }
    this.#accessHashes.set(key, accessHash);
  }

  /**
  The access hash of a call the engine knows.
  
  A call the engine has never seen is a call the browser made up, and the
  bridge answers that with a 404 rather than passing a nonsense peer to
  Telegram.
  */
  accessHash(callId: string): string {
    const accessHash = this.#accessHashes.get(callId);
    if (accessHash === undefined) {
      throw new EngineError(`Unknown call: ${callId}`, 404);
    }
    // A lookup is a use: refresh its position so a call still being signalled
    // is not the one evicted when the registry fills.
    this.#accessHashes.delete(callId);
    this.#accessHashes.set(callId, accessHash);
    return accessHash;
  }

  /**
  Whether a call is known.
  */
  knows(callId: string): boolean {
    return this.#accessHashes.has(callId);
  }

  /**
  Forgets a call. A discarded call is over, and its hash is of no use to
  anything that comes after it.
  */
  forget(callId: string): void {
    this.#accessHashes.delete(callId);
  }

  /**
  Forgets every call — the account signed out, and the ids mean nothing to
  whoever signs in next.
  */
  clear(): void {
    this.#accessHashes.clear();
  }
}
