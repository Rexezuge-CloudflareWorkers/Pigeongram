import { describe, expect, it } from 'vitest';
import { EngineError } from '../../packages/backend-services/src/session/errors';
import {
  clampInt,
  optionalAnswerIndexes,
  optionalInt,
  optionalMessageId,
  optionalRandomId,
  optionalText,
  requireCallbackData,
  requireMessageId,
  requireMessageIds,
  requirePeerId,
  requireQuery,
  requireText,
} from '../../packages/backend-services/src/session/params';

describe('bridge parameter validation', () => {
  it('accepts marked peer ids and rejects everything else', () => {
    expect(requirePeerId(-1_000_000_000_020)).toBe(-1_000_000_000_020);
    expect(requirePeerId(42)).toBe(42);
    for (const bad of [undefined, null, '42', 0, 1.5, NaN, Infinity]) {
      expect(() => requirePeerId(bad)).toThrow(EngineError);
    }
  });

  it('requires positive message ids', () => {
    expect(requireMessageId(7)).toBe(7);
    for (const bad of [undefined, null, '7', 0, -1, 1.5, NaN, Infinity]) {
      expect(() => requireMessageId(bad)).toThrow(EngineError);
    }
  });

  it('requires a bounded, distinct list of message ids', () => {
    expect(requireMessageIds([7])).toEqual([7]);
    expect(requireMessageIds([7, 8, 9])).toEqual([7, 8, 9]);
    const tooMany = Array.from({ length: 101 }, (_, index) => index + 1);
    for (const bad of [undefined, null, [], '7', [0], [1.5], [1, 1], tooMany]) {
      expect(() => requireMessageIds(bad)).toThrow(EngineError);
    }
  });

  it('treats an absent reply target as undefined but validates a present one', () => {
    expect(optionalMessageId(undefined)).toBeUndefined();
    expect(optionalMessageId(null)).toBeUndefined();
    expect(optionalMessageId(7)).toBe(7);
    for (const bad of ['7', 0, -1, 1.5, NaN, Infinity]) {
      expect(() => optionalMessageId(bad)).toThrow(EngineError);
    }
  });

  it('accepts a positive decimal random id and rejects everything else', () => {
    expect(optionalRandomId(undefined)).toBeUndefined();
    expect(optionalRandomId(null)).toBeUndefined();
    expect(optionalRandomId('123456789')?.toString()).toBe('123456789');
    for (const bad of ['', 'abc', '-1', '0', '1.5', 12, ' 1', '9223372036854775808']) {
      expect(() => optionalRandomId(bad)).toThrow(EngineError);
    }
  });

  it('treats absent optional text as undefined and rejects empty strings', () => {
    expect(optionalText(undefined, 32, 'emoji')).toBeUndefined();
    expect(optionalText(null, 32, 'emoji')).toBeUndefined();
    expect(optionalText('👍', 32, 'emoji')).toBe('👍');
    expect(() => optionalText('', 32, 'emoji')).toThrow(EngineError);
    expect(() => optionalText(42, 32, 'emoji')).toThrow(EngineError);
    expect(() => optionalText('x'.repeat(33), 32, 'emoji')).toThrow(EngineError);
  });

  it('clamps integers into range and falls back when absent', () => {
    expect(clampInt(undefined, 1, 30, 7)).toBe(7);
    expect(clampInt(null, 1, 30, 7)).toBe(7);
    expect(clampInt(0, 1, 30, 7)).toBe(1);
    expect(clampInt(99, 1, 30, 7)).toBe(30);
    expect(clampInt(2.9, 1, 30, 7)).toBe(2);
    expect(() => clampInt('many', 1, 30, 7)).toThrow(EngineError);
    expect(() => clampInt(NaN, 1, 30, 7)).toThrow(EngineError);
  });

  it('treats absent offset parameters as undefined', () => {
    expect(optionalInt(undefined)).toBeUndefined();
    expect(optionalInt(null)).toBeUndefined();
    expect(optionalInt(0)).toBe(0);
    expect(optionalInt(123)).toBe(123);
    expect(() => optionalInt(-1)).toThrow(EngineError);
    expect(() => optionalInt('1')).toThrow(EngineError);
  });

  it('requires non-empty bounded text and queries', () => {
    expect(requireText('hi')).toBe('hi');
    expect(() => requireText(' '.repeat(3))).toThrow(EngineError);
    expect(() => requireText(42)).toThrow(EngineError);
    expect(() => requireText('x'.repeat(11), 10)).toThrow(EngineError);

    expect(requireQuery('find me')).toBe('find me');
    expect(() => requireQuery('')).toThrow(EngineError);
    expect(() => requireQuery('x'.repeat(257))).toThrow(EngineError);
  });

  it('reads absent vote answers as a retraction and bounds the rest', () => {
    expect(optionalAnswerIndexes(undefined)).toBeNull();
    expect(optionalAnswerIndexes(null)).toBeNull();
    expect(optionalAnswerIndexes([0])).toEqual([0]);
    expect(optionalAnswerIndexes([0, 9])).toEqual([0, 9]);
    for (const bad of [[], '0', [1.5], [-1], [NaN], [null], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) {
      expect(() => optionalAnswerIndexes(bad)).toThrow(EngineError);
    }
  });

  it('decodes callback data and rejects malformed or oversized payloads', () => {
    expect(Array.from(requireCallbackData('AQID'))).toEqual([1, 2, 3]);
    expect(requireCallbackData('')).toEqual(new Uint8Array());
    for (const bad of [undefined, null, 'AQI', '***', 'A===', 'A'.repeat(88)]) {
      expect(() => requireCallbackData(bad)).toThrow(EngineError);
    }
  });
});
