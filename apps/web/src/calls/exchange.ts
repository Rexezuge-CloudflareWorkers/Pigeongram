import { deriveSharedKey, keyFingerprint } from './dh';
import type { DhConfig } from './dh';
import { sha256 } from './hash';

/**
 * The key establishment of a call.
 *
 * Both peers end up with the same key and the same fingerprint of it, and
 * each of them can check that the value the other side sent is the one it
 * committed to. This module is that check, so the controller only has to say
 * *when* it happens.
 */

/**
 * What a peer sends along with the key exchange.
 */
export interface KeyOptions {
  /**
   * The public parameters of the exchange.
   */
  config: DhConfig;
  /**
   * This side's private exponent.
   */
  secret: bigint;
  /**
   * The other side's public value.
   */
  peerValue: Uint8Array;
  /**
   * The commitment the caller sent, when this side is the callee. The
   * caller's public value must hash to it.
   */
  commitment?: Uint8Array | null;
  /**
   * The fingerprint the server relayed, when it carries one. It must be the
   * fingerprint of the derived key.
   */
  expectedFingerprint?: string | null;
}

/**
 * The key the two peers share, and its fingerprint.
 */
export interface EstablishedKey {
  key: Uint8Array;
  fingerprint: string;
}

/**
 * Derives the shared key and checks it against everything the other side
 * committed to.
 */
export async function establishKey(options: KeyOptions): Promise<EstablishedKey> {
  if (options.commitment) {
    const hash = await sha256(options.peerValue);
    if (!sameBytes(hash, options.commitment)) {
      throw new Error("The peer's key exchange value does not match its commitment");
    }
  }
  const key = await deriveSharedKey(options.config, options.secret, options.peerValue);
  const fingerprint = await keyFingerprint(key);
  if (options.expectedFingerprint && options.expectedFingerprint !== fingerprint) {
    throw new Error('The key fingerprint does not match');
  }
  return { key, fingerprint };
}

/**
 * Whether two byte arrays are the same.
 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (const [index, element] of a.entries()) {
    difference |= element ^ b[index];
  }
  return difference === 0;
}
