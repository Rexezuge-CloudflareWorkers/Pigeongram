import { ServiceError } from '@rexezuge/errors';
import { describe, expect, it } from 'vitest';
import { EngineConfigError, readApiCredentials } from '../../packages/provider-clients/src/mtproto/client';
import { EngineError, STORAGE_WRITE_QUOTA_MESSAGE, isStorageWriteQuotaError } from '../../packages/backend-services/src/session/errors';

/**
 * The engine's failure vocabulary on the family's taxonomy.
 *
 * The bridge is one boundary in a family of workers, so its errors have to be
 * `ServiceError`s: the mapper branches on that class, and an `EngineError` that
 * only looked like one would arrive at the client as a masked 500.
 */

describe('EngineError', () => {
  it('is a ServiceError whose type is the bridge code', () => {
    const error = new EngineError('bad input', 400);

    expect(error).toBeInstanceOf(ServiceError);
    expect(error.status).toBe(400);
    expect(error.type).toBe('validation');
    expect(error.code).toBe('validation');
    expect(error.expose).toBe(true);
    expect(error.message).toBe('bad input');
  });

  it('derives a coarse code from the status', () => {
    const cases: Array<[number, string]> = [
      [400, 'validation'],
      [401, 'access'],
      [403, 'access'],
      [404, 'not_found'],
      [409, 'conflict'],
      [502, 'upstream'],
      [503, 'unavailable'],
      [504, 'unavailable'],
      [500, 'internal'],
    ];
    for (const [status, code] of cases) {
      expect(new EngineError('failure', status).code, String(status)).toBe(code);
    }
  });

  it('lets a call site name a more specific code', () => {
    expect(new EngineError('over budget', 503, 'storage_write_quota').type).toBe('storage_write_quota');
  });

  it('serializes to the canonical envelope', () => {
    expect(new EngineError('bad input', 409).toErrorResponse()).toEqual({
      status: 409,
      body: { Exception: { Type: 'conflict', Message: 'bad input' } },
    });
  });
});

describe('EngineConfigError', () => {
  it('is an exposing 503 config failure', () => {
    const error = new EngineConfigError('TELEGRAM_API_ID is missing');

    expect(error).toBeInstanceOf(ServiceError);
    expect(error.status).toBe(503);
    expect(error.type).toBe('config');
    expect(error.expose).toBe(true);
    expect(error.toErrorResponse()).toEqual({
      status: 503,
      body: { Exception: { Type: 'config', Message: 'TELEGRAM_API_ID is missing' } },
    });
  });
});

describe('readApiCredentials', () => {
  const valid = { TELEGRAM_API_ID: '12345', TELEGRAM_API_HASH: 'abc123' };

  it('reads the pair', () => {
    expect(readApiCredentials(valid)).toEqual({ apiId: 12_345, apiHash: 'abc123' });
  });

  it('trims the hash and accepts a padded id', () => {
    expect(readApiCredentials({ TELEGRAM_API_ID: ' 12345 ', TELEGRAM_API_HASH: ' abc123 ' })).toEqual({
      apiId: 12_345,
      apiHash: 'abc123',
    });
  });

  it('refuses an absent, malformed or non-positive id', () => {
    for (const value of [undefined, '', 'nope', '0', '-1', '12.5']) {
      const env = { TELEGRAM_API_HASH: 'abc123', ...(value !== undefined && { TELEGRAM_API_ID: value }) };
      expect(() => readApiCredentials(env), String(value)).toThrow(EngineConfigError);
    }
  });

  it('refuses an absent or blank hash', () => {
    expect(() => readApiCredentials({ TELEGRAM_API_ID: '12345' })).toThrow(EngineConfigError);
    expect(() => readApiCredentials({ TELEGRAM_API_ID: '12345', TELEGRAM_API_HASH: ' '.repeat(3) })).toThrow(EngineConfigError);
  });
});

describe('isStorageWriteQuotaError', () => {
  it('recognises the runtime wording, wrapped or not', () => {
    expect(isStorageWriteQuotaError(new Error('Exceeded allowed rows written in Durable Objects free tier'))).toBe(true);
    expect(isStorageWriteQuotaError('Exceeded allowed rows written in Durable Objects free tier')).toBe(true);
    expect(isStorageWriteQuotaError(new Error('network down'))).toBe(false);
    expect(STORAGE_WRITE_QUOTA_MESSAGE).toContain('00:00 UTC');
  });
});
