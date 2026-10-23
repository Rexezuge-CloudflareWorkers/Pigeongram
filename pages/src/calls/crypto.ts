/**
 * The call's packet envelope.
 *
 * This is the layer Telegram's documentation describes for end-to-end
 * encrypted calls: a message is a counter, a payload, and a per-message key
 * schedule derived from the shared Diffie-Hellman key. The schedule is
 * reproduced here exactly as documented, because it is what makes the packets
 * opaque to everyone but the two peers:
 *
 * ```text
 * msg_key_large = SHA256(substr(key, 88 + x, 32) + body)
 * msg_key       = substr(msg_key_large, 8, 16)
 * sha256_a      = SHA256(msg_key + substr(key, x, 36))
 * sha256_b      = SHA256(substr(key, 40 + x, 36) + msg_key)
 * aes_key       = substr(sha256_a, 0, 8) + substr(sha256_b, 8, 16) + substr(sha256_a, 24, 8)
 * aes_iv        = substr(sha256_b, 0, 4) + substr(sha256_a, 8, 8) + substr(sha256_b, 24, 4)
 * packet        = msg_key + AES-CTR(body, aes_key, aes_iv)
 * ```
 *
 * The `x` offset separates the directions and the channels: a key is good for
 * one direction and one channel only, so a packet cannot be replayed back at
 * its sender or moved from the signalling channel onto the transport.
 *
 * The offset is anchored to the **caller** — the party that started the call.
 * The caller's packets use the "outgoing" offsets and the callee's use the
 * "incoming" ones, so the two sides meet in the middle: what the caller
 * writes with x=128 the callee reads with x=128, and what the callee writes
 * with x=136 the caller reads with x=136. Both sides know who started the
 * call, so nothing has to be negotiated about it.
 *
 * The key schedule depends on the message body, so every message gets its own
 * key and its own counter block — there is no keystream to reuse.
 */

import { concat, equalBytes, sha256, slice } from './hash';

/**
 * The two channels a call has.
 *
 * Signalling rides Telegram's API; transport rides the peer connection.
 */
export type CallChannel = 'transport' | 'signaling';

/**
 * The offset of the caller's packets.
 */
const OUTGOING_OFFSET: Readonly<Record<CallChannel, number>> = { transport: 0, signaling: 128 };

/**
 * The offset of the callee's packets.
 */
const INCOMING_OFFSET: Readonly<Record<CallChannel, number>> = { transport: 8, signaling: 136 };

/**
 * How many messages the replay window holds.
 *
 * A packet whose counter has fallen out of the window is refused: it is too
 * old to be part of this exchange, and the window is what keeps a captured
 * packet from being replayed later.
 */
const REPLAY_WINDOW = 64;

/**
 * The length of the counter that precedes every payload.
 */
const SEQ_BYTES = 4;

/**
 * The length of the key check that precedes every packet.
 */
const MSG_KEY_BYTES = 16;

/**
 * Encrypts and decrypts the packets of one call.
 */
export class CallCipher {
  /**
   * The counter of the next outgoing message, per channel: each channel has
   * its own, so a packet on one cannot be mistaken for a packet on the other.
   */
  readonly #outgoingSeq: Record<CallChannel, number> = { transport: 1, signaling: 1 };

  /**
   * The highest counter seen on the incoming side, per channel.
   */
  readonly #maxIncomingSeq: Record<CallChannel, number> = { transport: 0, signaling: 0 };

  /**
   * The incoming counters inside the replay window.
   */
  readonly #incomingSeqs: Record<CallChannel, Set<number>> = {
    transport: new Set<number>(),
    signaling: new Set<number>(),
  };

  /**
   * @param key the shared key of the call.
   * @param originator whether this side is the caller — the party that
   * started the call. The offsets are anchored to the caller.
   */
  constructor(
    private readonly key: Uint8Array,
    private readonly originator: boolean,
  ) {
    if (key.length !== 256) {
      throw new Error('The call key must be 256 bytes wide');
    }
  }

  /**
   * Encrypts one payload into a packet.
   *
   * The counter goes in front of the payload: it is part of the signed body,
   * so a peer can tell a fresh packet from a replayed one.
   */
  async encrypt(channel: CallChannel, payload: Uint8Array): Promise<Uint8Array> {
    const body = new Uint8Array(SEQ_BYTES + payload.length);
    new DataView(body.buffer).setUint32(0, this.#outgoingSeq[channel], true);
    body.set(payload, SEQ_BYTES);
    const packet = await this.#seal(channel, body);
    this.#outgoingSeq[channel] = (this.#outgoingSeq[channel] + 1) >>> 0;
    return packet;
  }

  /**
   * Decrypts one packet, or returns `null` when the packet is not ours.
   *
   * A packet is refused when its key check does not match the body it
   * carries, when its counter has fallen out of the replay window, or when
   * the same counter has been seen before.
   */
  async decrypt(channel: CallChannel, packet: Uint8Array): Promise<Uint8Array | null> {
    if (packet.length <= MSG_KEY_BYTES + SEQ_BYTES) return null;
    const msgKey = slice(packet, 0, MSG_KEY_BYTES);
    const body = await this.#open(channel, msgKey, slice(packet, MSG_KEY_BYTES));
    if (body === null) return null;
    const seq = new DataView(body.buffer, body.byteOffset, SEQ_BYTES).getUint32(0, true);
    if (seq === 0) return null;
    const seen = this.#incomingSeqs[channel];
    const highest = this.#maxIncomingSeq[channel];
    if (seq <= highest - REPLAY_WINDOW || seen.has(seq)) return null;
    seen.add(seq);
    if (seq > highest) this.#maxIncomingSeq[channel] = seq;
    for (const received of seen) {
      if (received <= this.#maxIncomingSeq[channel] - REPLAY_WINDOW) seen.delete(received);
    }
    // A copy, so the caller holds the payload and not a window into the
    // packet's buffer.
    return body.slice(SEQ_BYTES);
  }

  /**
   * Builds the packet: the key check in front of the encrypted body.
   *
   * The offset is the caller's when this side is the caller and the
   * callee's otherwise — the two peers agree on it because they know who
   * started the call.
   */
  async #seal(channel: CallChannel, body: Uint8Array): Promise<Uint8Array> {
    const x = this.originator ? OUTGOING_OFFSET[channel] : INCOMING_OFFSET[channel];
    const msgKeyLarge = await sha256(concat(slice(this.key, 88 + x, 32), body));
    const msgKey = slice(msgKeyLarge, 8, MSG_KEY_BYTES);
    const { aesKey, aesIv } = await this.#schedule(msgKey, x);
    const encrypted = await aesCtr(aesKey, aesIv, body);
    return concat(msgKey, encrypted);
  }

  /**
   * Reads the packet: the encrypted body behind the key check.
   *
   * The body is decrypted first and the key check is recomputed over it — so
   * a packet whose check does not match is refused rather than trusted.
   */
  async #open(channel: CallChannel, msgKey: Uint8Array, encrypted: Uint8Array): Promise<Uint8Array | null> {
    const x = this.originator ? INCOMING_OFFSET[channel] : OUTGOING_OFFSET[channel];
    const { aesKey, aesIv } = await this.#schedule(msgKey, x);
    const body = await aesCtr(aesKey, aesIv, encrypted);
    const msgKeyLarge = await sha256(concat(slice(this.key, 88 + x, 32), body));
    if (!equalBytes(slice(msgKeyLarge, 8, MSG_KEY_BYTES), msgKey)) return null;
    return body;
  }

  /**
   * The per-message key and counter block.
   */
  async #schedule(msgKey: Uint8Array, x: number): Promise<{ aesKey: Uint8Array; aesIv: Uint8Array }> {
    const a = await sha256(concat(msgKey, slice(this.key, x, 36)));
    const b = await sha256(concat(slice(this.key, 40 + x, 36), msgKey));
    const aesKey = concat(slice(a, 0, 8), slice(b, 8, 16), slice(a, 24, 8));
    const aesIv = concat(slice(b, 0, 4), slice(a, 8, 8), slice(b, 24, 4));
    return { aesKey, aesIv };
  }
}

/**
 * AES in counter mode.
 *
 * The whole 128-bit counter block is the counter, so the mode is the plain
 * one Telegram's clients use. The key and the counter block are per message,
 * which is what keeps two messages from sharing a keystream.
 */
async function aesCtr(key: Uint8Array, counter: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CTR', false, ['encrypt', 'decrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter: counter as BufferSource, length: 128 },
    cryptoKey,
    data as BufferSource,
  );
  return new Uint8Array(encrypted);
}
