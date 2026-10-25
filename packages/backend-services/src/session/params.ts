import { Long } from '@mtcute/core';
import type { RpcBatchCall } from '../rpc-types';
import { EngineError } from './errors';

/**
 * Validation for the bridge's JSON parameters. The bridge is single-user and
 * behind a gate, but malformed input should still fail loudly with a 400
 * instead of being smuggled into mtcute.
 */

/**
How many calls one `batch` may carry.
*/
const MAX_BATCH_CALLS = 8;

/**
 * A JSON object. An absent value means "no parameters" and becomes `{}`; any
 * other non-object — a string, a number, an array — is a 400. The old
 * coercion turned `params: "garbage"` into an empty object and let the call
 * through.
 */
export function requireRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineError('params must be a JSON object', 400);
  }
  return value as Record<string, unknown>;
}

export function requirePeerId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) {
    throw new EngineError('chatId must be a marked Telegram peer id', 400);
  }
  return value;
}

export function requireMessageId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new EngineError('messageId must be a positive Telegram message id', 400);
  }
  return value;
}

/**
The ids of the messages a forward moves, in order: an album forwards its
members as one batch. Telegram caps a forward at 100 messages, and a repeated
id would forward the same message twice.
*/
export function requireMessageIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EngineError('messageIds must be a non-empty array of message ids', 400);
  }
  if (value.length > 100) {
    throw new EngineError('messageIds must hold at most 100 message ids', 400);
  }
  const ids = value.map((entry) => {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry <= 0) {
      throw new EngineError('messageIds must hold positive Telegram message ids', 400);
    }
    return entry;
  });
  if (new Set(ids).size !== ids.length) {
    throw new EngineError('messageIds must not repeat a message id', 400);
  }
  return ids;
}

/**
Decodes a callback button's base64 payload. Telegram caps callback data at 64
bytes; rejecting larger payloads keeps a malformed bridge call out of mtcute.
*/
export function requireCallbackData(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(value)) {
    throw new EngineError('data must be base64 of the button callback payload', 400);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new EngineError('data must be base64 of the button callback payload', 400);
  }
  if (binary.length > 64) {
    throw new EngineError('data must decode to at most 64 bytes', 400);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
Like `requireMessageId`, but `null`/`undefined` mean "not provided" instead of
an error — used where omission carries meaning (e.g. a plain reply).
*/
export function optionalMessageId(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireMessageId(value);
}

/**
Like `requireText`, but `null`/`undefined` mean "not provided" instead of an
error — used where omission carries meaning (e.g. removing a reaction).
*/
export function optionalText(value: unknown, max = 4096, name = 'value'): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EngineError(`${name} must be a non-empty string`, 400);
  }
  if (value.length > max) {
    throw new EngineError(`${name} must be at most ${max} characters`, 400);
  }
  return value;
}

export function optionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new EngineError('Expected a non-negative integer', 400);
  }
  return value;
}

/**
A boolean flag, or `undefined` when it was not provided. A flag that is there
but is not a boolean is a 400: the bridge never guesses what the caller meant.
*/
export function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new EngineError(`${name} must be a boolean`, 400);
  }
  return value;
}

/**
Like {@link optionalBoolean}, but the flag has to be there.
*/
export function requireBoolean(value: unknown, name: string): boolean {
  const parsed = optionalBoolean(value, name);
  if (parsed === undefined) {
    throw new EngineError(`${name} must be a boolean`, 400);
  }
  return parsed;
}

/**
 * A client-chosen Telegram `random_id`, as a positive decimal 64-bit integer.
 * Reusing it on a retry is what makes the retry idempotent: Telegram drops a
 * duplicate send whose random id it has already accepted.
 */
export function optionalRandomId(value: unknown): Long | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) {
    throw new EngineError('randomId must be a positive decimal 64-bit integer', 400);
  }
  const parsed = ((): Long => {
    try {
      return Long.fromString(value);
    } catch {
      throw new EngineError('randomId must be a positive decimal 64-bit integer', 400);
    }
  })();
  if (parsed.isNegative() || parsed.toString() !== value) {
    throw new EngineError('randomId must be a positive decimal 64-bit integer', 400);
  }
  return parsed;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EngineError('Expected a number', 400);
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
The answers a vote selects: a list of non-negative indexes into the poll's
answers, or `null`/`undefined` to retract the current vote. Telegram caps a
poll at ten answers, so the list can never be longer than that.
*/
export function optionalAnswerIndexes(value: unknown): number[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new EngineError('options must be an array of answer indexes, or null to retract', 400);
  }
  if (value.length === 0) {
    throw new EngineError('options must hold at least one answer index, or be null to retract', 400);
  }
  if (value.length > 10) {
    throw new EngineError('options must hold at most 10 answer indexes', 400);
  }
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) {
      throw new EngineError('options must hold non-negative integer indexes', 400);
    }
  }
  return value as number[];
}

export function requireText(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EngineError('text must be a non-empty string', 400);
  }
  if (value.length > max) {
    throw new EngineError(`text must be at most ${max} characters`, 400);
  }
  return value;
}

export function requirePhone(value: unknown): string {
  const phone = requireText(value, 32);
  if (!/^\+?[\d\s()-]{5,}$/.test(phone)) {
    throw new EngineError('phone must be an international number, e.g. +15551234567', 400);
  }
  return phone;
}

export function requireQuery(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EngineError('query must be a non-empty string', 400);
  }
  if (value.length > max) {
    throw new EngineError(`query must be at most ${max} characters`, 400);
  }
  return value;
}

/**
The calls a `batch` carries.

The list is capped so one request cannot become a fan-out amplifier, and every
method is checked against the batchable set the registry derived from its
read-only entries: a batch runs its calls concurrently, so a write in it would
have no defined completion order. The set is passed in rather than imported so
this validator has no runtime dependency on the method table that uses it.
*/
export function parseBatchCalls(value: unknown, batchable: ReadonlySet<string>): RpcBatchCall[] {
  if (!Array.isArray(value)) {
    throw new EngineError('calls must be an array of batched calls', 400);
  }
  if (value.length === 0) {
    throw new EngineError('calls must hold at least one batched call', 400);
  }
  if (value.length > MAX_BATCH_CALLS) {
    throw new EngineError(`calls must hold at most ${MAX_BATCH_CALLS} batched calls`, 400);
  }
  return value.map((entry, index) => {
    const record = requireRecord(entry);
    const method = record.method;
    if (typeof method !== 'string' || !batchable.has(method)) {
      throw new EngineError(`calls[${index}].method must be a batchable read method`, 400);
    }
    return {
      method: method as RpcBatchCall['method'],
      params: requireRecord(record.params),
    };
  });
}
