import { EngineError } from './errors';

/**
 * Validation for the bridge's JSON parameters. The bridge is single-user and
 * behind a gate, but malformed input should still fail loudly with a 400
 * instead of being smuggled into mtcute.
 */

export function requireRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
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
