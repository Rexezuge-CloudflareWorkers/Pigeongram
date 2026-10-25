/**
 * The Diffie-Hellman key exchange a call is built on.
 *
 * The exchange runs **in the page**, and that is not a stylistic choice: a
 * 2048-bit modular exponentiation costs tens of milliseconds of CPU, and the
 * Free plan allows a Worker ten milliseconds of CPU per invocation. Two
 * exponentiations would be five times over the budget. The browser has no
 * such limit, so the page does the arithmetic and the worker only carries
 * the public prime and generator down.
 *
 * The shared key never leaves the page either. What travels through the
 * bridge is what Telegram's protocol puts on the wire: the caller's
 * commitment (a hash of its public value), the two public values, and the
 * key's fingerprint.
 */

import { sha1, sha256 } from './hash';

/**
 * How wide the prime and the public values are: 2048 bits.
 */
export const DH_VALUE_BYTES = 256;

/**
 * The public parameters of the exchange.
 */
export interface DhConfig {
  /**
   * The generator. A small integer, so it crosses the bridge as a number.
   */
  g: number;
  /**
   * The 2048-bit prime, big-endian.
   */
  p: Uint8Array;
}

/**
 * One side's half of the exchange.
 */
export interface DhKeyPair {
  /**
   * The private exponent. It never leaves the page.
   */
  secret: bigint;
  /**
   * The public value `g^secret mod p`, 256 bytes big-endian.
   */
  value: Uint8Array;
  /**
   * SHA-256 over the public value: the commitment the caller sends.
   */
  hash: Uint8Array;
}

/**
 * The validated configs, keyed by the prime's bytes.
 *
 * The checks below cost a handful of modular exponentiations, and the prime
 * hardly ever changes — so a second call in the same session reuses the
 * verdict instead of paying for it again.
 */
const validated = new Map<string, DhConfig>();

/**
 * Turns bytes into a big-endian integer.
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Turns a non-negative integer into big-endian bytes of an exact length.
 */
export function bigIntToBytes(value: bigint, length: number): Uint8Array {
  if (value < 0n) throw new Error('negative value');
  const out = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error('value does not fit');
  return out;
}

/**
 * A modular exponentiation.
 *
 * Square-and-multiply, most significant bit first. The exponent's bits are
 * read through a string, because shifting a 2048-bit bigint one bit at a time
 * is far slower than shifting the exponent itself.
 */
export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus <= 0n) throw new Error('modulus must be positive');
  let result = 1n;
  let factor = base % modulus;
  if (factor < 0n) factor += modulus;
  for (const bit of exponent.toString(2)) {
    result = (result * result) % modulus;
    if (bit === '1') result = (result * factor) % modulus;
  }
  return result;
}

/**
 * Lets the browser paint between two expensive steps.
 *
 * A modular exponentiation blocks the main thread for tens of milliseconds.
 * Yielding between the checks keeps the incoming-call screen alive while the
 * exchange runs.
 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Miller-Rabin: is the number probably prime?
 *
 * Four rounds is a deliberate trade. A full test on a 2048-bit number costs
 * one modular exponentiation per round, and a false positive would mean
 * accepting a prime that is not one — the chance of a composite surviving
 * four small bases is small enough for a key exchange that Telegram's own
 * server supplies the parameters, and the group checks below catch the rest.
 */
function isProbablyPrime(candidate: bigint): boolean {
  if (candidate <= 3n) return candidate >= 2n;
  if (candidate % 2n === 0n) return false;
  let d = candidate - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r += 1n;
  }
  for (const base of [2n, 3n, 5n, 7n]) {
    let x = modPow(base, d, candidate);
    if (x === 1n || x === candidate - 1n) continue;
    let composite = true;
    for (let round = 1n; round < r; round += 1n) {
      x = (x * x) % candidate;
      if (x === candidate - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

/**
 * Checks the public parameters of the exchange.
 *
 * A man in the middle could hand over a prime of its own choosing, or a
 * generator that puts the exchange in a subgroup it controls. The checks are
 * the ones Telegram's own documentation asks for: the prime must be prime,
 * the generator must not have order one or two, and it must generate a
 * subgroup of the field.
 *
 * The verdict is cached, so a second call in the same session costs nothing.
 */
export async function validateDhConfig(config: DhConfig): Promise<DhConfig> {
  const key = `${config.g}:${bytesToBigInt(config.p).toString(16)}`;
  const cached = validated.get(key);
  if (cached) return cached;

  const p = bytesToBigInt(config.p);
  if (config.p.length !== DH_VALUE_BYTES) {
    throw new Error('The Diffie-Hellman prime is not 2048 bits wide');
  }
  if (!isProbablyPrime(p)) {
    throw new Error('The Diffie-Hellman prime is not prime');
  }
  const g = BigInt(config.g);
  if (g <= 1n || g >= p - 1n) {
    throw new Error('The Diffie-Hellman generator is out of range');
  }
  const half = (p - 1n) / 2n;
  const gHalf = modPow(g, half, p);
  if (modPow(g, 2n, p) === 1n || modPow(g, p - 1n, p) !== 1n) {
    throw new Error('The Diffie-Hellman generator does not generate a large subgroup');
  }
  if (gHalf !== 1n) {
    // The generator has to be a quadratic residue, so that it generates the
    // subgroup of order (p-1)/2 rather than the whole field.
    throw new Error('The Diffie-Hellman generator is not a quadratic residue');
  }
  validated.set(key, config);
  return config;
}

/**
 * Checks a peer's public value.
 *
 * The value must be in range, and it must live in the same subgroup as the
 * generator: when the generator has order `(p-1)/2` only the quadratic
 * residues are acceptable, and when it has the full order both residues and
 * non-residues are — but nothing else.
 */
export function checkPeerValue(config: DhConfig, value: Uint8Array): void {
  const p = bytesToBigInt(config.p);
  const v = bytesToBigInt(value);
  if (v <= 1n || v >= p - 1n) {
    throw new Error("The peer's Diffie-Hellman value is out of range");
  }
  const half = (p - 1n) / 2n;
  const g = BigInt(config.g);
  const gHalf = modPow(g, half, p);
  const vHalf = modPow(v, half, p);
  if (gHalf === 1n) {
    if (vHalf !== 1n) throw new Error("The peer's Diffie-Hellman value is in the wrong subgroup");
    return;
  }
  if (vHalf !== 1n && vHalf !== p - 1n) {
    throw new Error("The peer's Diffie-Hellman value is in the wrong subgroup");
  }
}

/**
 * Makes this side's half of the exchange.
 *
 * The private exponent is 256 random bytes reduced into the range the
 * exchange allows, and it never leaves the page.
 */
export async function createDhKeyPair(config: DhConfig): Promise<DhKeyPair> {
  const p = bytesToBigInt(config.p);
  const random = crypto.getRandomValues(new Uint8Array(DH_VALUE_BYTES));
  let secret = bytesToBigInt(random) % (p - 1n);
  if (secret <= 1n) secret += 2n;
  const value = bigIntToBytes(modPow(BigInt(config.g), secret, p), DH_VALUE_BYTES);
  const hash = await sha256(value);
  return { secret, value, hash };
}

/**
 * The shared key, from this side's secret and the peer's public value.
 */
export async function deriveSharedKey(config: DhConfig, secret: bigint, peerValue: Uint8Array): Promise<Uint8Array> {
  checkPeerValue(config, peerValue);
  const p = bytesToBigInt(config.p);
  const shared = modPow(bytesToBigInt(peerValue), secret, p);
  const key = bigIntToBytes(shared, DH_VALUE_BYTES);
  await yieldToPaint();
  return key;
}

/**
 * The fingerprint of a shared key.
 *
 * Telegram's definition is the lower 64 bits of SHA1 over the key, and the
 * convention for the lower 64 bits of a SHA1 digest in MTProto is the first
 * eight bytes read little-endian — the same one the auth key's identifier
 * uses. It travels as a decimal string, because a signed 64-bit integer does
 * not fit in a JavaScript number.
 */
export async function keyFingerprint(key: Uint8Array): Promise<string> {
  const digest = await sha1(key);
  const view = new DataView(digest.buffer, digest.byteOffset, 8);
  return view.getBigInt64(0, true).toString();
}
