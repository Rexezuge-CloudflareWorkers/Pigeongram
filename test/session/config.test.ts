import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_WAKE_INTERVAL_SECONDS,
  MEDIA_WINDOW_BYTES,
  readEngineConfig,
} from '../../packages/backend-services/src/session/config';

/**
 * The environment is untrusted input: a deployment can omit a var, typo it, or
 * set it below the floor. Every case must land on a usable number, because a
 * wake that arms in one millisecond or an upload cap of zero takes the account
 * offline without an error a reader can act on.
 */

describe('readEngineConfig', () => {
  it('uses the documented defaults when neither var is set', () => {
    expect(readEngineConfig({})).toEqual({
      wakeIntervalSeconds: DEFAULT_WAKE_INTERVAL_SECONDS,
      wakeIntervalMs: DEFAULT_WAKE_INTERVAL_SECONDS * 1000,
      maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
      mediaWindowBytes: MEDIA_WINDOW_BYTES,
    });
  });

  it('reads the wake cadence in seconds and milliseconds', () => {
    const config = readEngineConfig({ WAKE_INTERVAL_SECONDS: '120' });

    expect(config.wakeIntervalSeconds).toBe(120);
    expect(config.wakeIntervalMs).toBe(120_000);
  });

  it('keeps a fractional cadence without rounding it twice', () => {
    expect(readEngineConfig({ WAKE_INTERVAL_SECONDS: '30.5' }).wakeIntervalMs).toBe(30_500);
  });

  it('falls back to the default below the 30-second floor', () => {
    for (const value of ['29', '0', '-30', '0.5']) {
      expect(readEngineConfig({ WAKE_INTERVAL_SECONDS: value }).wakeIntervalSeconds, value).toBe(DEFAULT_WAKE_INTERVAL_SECONDS);
    }
  });

  it('falls back to the default for an unusable cadence', () => {
    for (const value of ['', 'nope', 'Infinity', 'NaN']) {
      expect(readEngineConfig({ WAKE_INTERVAL_SECONDS: value }).wakeIntervalMs, value).toBe(DEFAULT_WAKE_INTERVAL_SECONDS * 1000);
    }
  });

  it('reads the upload cap as whole bytes', () => {
    expect(readEngineConfig({ UPLOAD_MAX_BYTES: '1048576' }).maxUploadBytes).toBe(1_048_576);
    expect(readEngineConfig({ UPLOAD_MAX_BYTES: '10.9' }).maxUploadBytes).toBe(10);
  });

  it('falls back to the default for an unusable upload cap', () => {
    for (const value of ['', 'nope', '0', '-1', '0.5', 'Infinity']) {
      expect(readEngineConfig({ UPLOAD_MAX_BYTES: value }).maxUploadBytes, value).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    }
  });

  it('pins the media window to Telegram’s 1 MB part block', () => {
    expect(readEngineConfig({}).mediaWindowBytes).toBe(1024 * 1024);
  });
});
