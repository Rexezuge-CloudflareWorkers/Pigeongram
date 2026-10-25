import { Long } from '@mtcute/core';
import type { CallDiscardReason } from '../call-types';
import { decodeBase64 } from './base64';
import { EngineError } from './errors';

/**
 * Validation for the calls half of the bridge's parameters.
 *
 * The call surface carries bytes and 64-bit numbers, so it needs its own
 * validators: the shared ones in `params.ts` cover the chat surface, where
 * every id is a small number.
 */

/**
 * How long a Diffie-Hellman value is: the prime is 2048 bits.
 */
const DH_VALUE_BYTES = 256;

/**
 * How long the caller's commitment is: SHA-256 over its public value.
 */
const DH_HASH_BYTES = 32;

/**
 * The largest signalling packet the bridge carries.
 *
 * The engine's own guard on the inbound side is the same number, so a
 * packet that is too big is refused before it reaches Telegram.
 */
export const MAX_SIGNALING_BYTES = 64 * 1024;

/**
 * Decodes a byte payload of the bridge.
 *
 * The maximum is the caller's business: the Diffie-Hellman values are fixed
 * size, and the signalling packets have their own limit.
 */
export function requireBytes(value: unknown, name: string, maxBytes: number): Uint8Array {
  if (typeof value !== 'string') {
    throw new EngineError(`${name} must be base64`, 400);
  }
  const bytes = decodeBase64(value);
  if (bytes === null) {
    throw new EngineError(`${name} must be base64`, 400);
  }
  if (bytes.length > maxBytes) {
    throw new EngineError(`${name} must decode to at most ${maxBytes} bytes`, 400);
  }
  return bytes;
}

/**
 * A Diffie-Hellman value: exactly 256 bytes.
 */
export function requireDhValue(value: unknown, name: string): Uint8Array {
  const bytes = requireBytes(value, name, DH_VALUE_BYTES);
  if (bytes.length !== DH_VALUE_BYTES) {
    throw new EngineError(`${name} must decode to ${DH_VALUE_BYTES} bytes`, 400);
  }
  return bytes;
}

/**
 * The caller's commitment: SHA-256 over its Diffie-Hellman value.
 *
 * Telegram's `g_a_hash` is the 32-byte digest, not the 256-byte value it
 * commits to — the value itself only travels on `phone.confirmCall`.
 */
export function requireDhHash(value: unknown, name: string): Uint8Array {
  const bytes = requireBytes(value, name, DH_HASH_BYTES);
  if (bytes.length !== DH_HASH_BYTES) {
    throw new EngineError(`${name} must decode to ${DH_HASH_BYTES} bytes`, 400);
  }
  return bytes;
}

/**
 * A call's id, as Telegram's `long`.
 */
export function requireCallId(value: unknown): Long {
  if (typeof value !== 'string' || !/^-?\d{1,19}$/.test(value)) {
    throw new EngineError('callId must be a decimal Telegram call id', 400);
  }
  const parsed = ((): Long => {
    try {
      return Long.fromString(value);
    } catch {
      throw new EngineError('callId must be a decimal Telegram call id', 400);
    }
  })();
  if (parsed.toString() !== value) {
    throw new EngineError('callId must be a decimal Telegram call id', 400);
  }
  return parsed;
}

/**
 * The key fingerprint: the lower 64 bits of SHA1 over the shared key, signed.
 */
export function requireFingerprint(value: unknown): Long {
  if (typeof value !== 'string' || !/^-?\d{1,19}$/.test(value)) {
    throw new EngineError('keyFingerprint must be a decimal 64-bit integer', 400);
  }
  const parsed = ((): Long => {
    try {
      return Long.fromString(value);
    } catch {
      throw new EngineError('keyFingerprint must be a decimal 64-bit integer', 400);
    }
  })();
  if (parsed.toString() !== value) {
    throw new EngineError('keyFingerprint must be a decimal 64-bit integer', 400);
  }
  return parsed;
}

/**
 * The client's own random id for a call request.
 *
 * Telegram's is a 32-bit integer, and the client picks it so a retry is not
 * a second call.
 */
export function requireCallRandomId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new EngineError('randomId must be a positive decimal 32-bit integer', 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 0xff_ff_ff_ff) {
    throw new EngineError('randomId must be a positive decimal 32-bit integer', 400);
  }
  return parsed;
}

/**
 * How long a call ran.
 */
export function requireDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new EngineError('duration must be a non-negative number of seconds', 400);
  }
  return value;
}

/**
 * Why a call ended.
 */
export function requireDiscardReason(value: unknown): CallDiscardReason {
  if (value !== 'missed' && value !== 'disconnect' && value !== 'hangup' && value !== 'busy') {
    throw new EngineError('reason must be one of missed, disconnect, hangup, busy', 400);
  }
  return value;
}

/**
 * A rating for a finished call.
 */
export function requireRating(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 5) {
    throw new EngineError('rating must be a score from 1 to 5', 400);
  }
  return value;
}

/**
 * The comment a rating carries.
 */
export function requireComment(value: unknown): string {
  if (typeof value !== 'string') {
    throw new EngineError('comment must be a string', 400);
  }
  if (value.length > 1024) {
    throw new EngineError('comment must be at most 1024 characters', 400);
  }
  return value;
}
