import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../packages/backend-services/src/session/log';

/**
 * A log line is data, not prose: tests (and Workers Logs) should be able to
 * read the event and its fields without matching a message. These cases pin
 * the envelope, the console method per level, and the failure-safe encoding.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function capture(method: 'log' | 'warn' | 'error'): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, method).mockImplementation(() => {});
}

function line(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls[0]?.[0];
  expect(typeof call).toBe('string');
  return JSON.parse(call as string) as Record<string, unknown>;
}

describe('log', () => {
  it('writes one JSON line at the level’s console method', () => {
    const info = capture('log');
    const warn = capture('warn');
    const error = capture('error');

    log.info('wake.skipped', { reason: 'not_signed_in' });
    log.warn('albums.reconcile_failed', { chatId: 7 });
    log.error('request.failed', { status: 500 });

    expect(line(info)).toEqual({ level: 'info', event: 'wake.skipped', reason: 'not_signed_in' });
    expect(line(warn)).toEqual({ level: 'warn', event: 'albums.reconcile_failed', chatId: 7 });
    expect(line(error)).toEqual({ level: 'error', event: 'request.failed', status: 500 });
  });

  it('keeps an error’s name and message as fields', () => {
    const error = capture('error');
    log.error('login.failed', { error: new TypeError('no DC') });

    expect(line(error)).toMatchObject({
      level: 'error',
      event: 'login.failed',
      error: { name: 'TypeError', message: 'no DC' },
    });
  });

  it('serializes a bigint field instead of throwing', () => {
    const info = capture('log');
    log.info('call.started', { callId: 123n });

    expect(line(info)).toMatchObject({ callId: '123' });
  });

  it('survives a circular field and still names the event', () => {
    const warn = capture('warn');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    log.warn('peer.refreshing', { circular });

    expect(line(warn)).toEqual({ level: 'warn', event: 'peer.refreshing', fields: '[unserializable]' });
  });

  it('lets no field shadow the envelope', () => {
    const info = capture('log');
    log.info('wake.skipped', { level: 'error', event: 'spoofed' });

    expect(line(info)).toEqual({ level: 'info', event: 'wake.skipped' });
  });
});
