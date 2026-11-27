import { describe, expect, it } from 'vitest';
import { loginPhaseMessage } from '../../apps/web/src/login-copy';
import type { EngineStateDto } from '../../apps/web/src/types';

/**
The login screen's sentences. Each phase and each code-delivery kind is one
branch of `loginPhaseMessage`, and a branch nothing exercises is a sentence no
one has read: the switch is the place where a new Telegram phase or delivery
kind lands.
*/
function state(patch: Partial<EngineStateDto>): EngineStateDto {
  return { phase: 'qr', authorized: false, me: null, ...patch };
}

describe('loginPhaseMessage', () => {
  it('names the engine while there is no snapshot yet', () => {
    expect(loginPhaseMessage(null)).toBe('Connecting To The Session Engine…');
  });

  it('covers every phase', () => {
    expect(loginPhaseMessage(state({ phase: 'qr' }))).toMatch(/^Scan This QR Code From Telegram/);
    expect(loginPhaseMessage(state({ phase: 'scanned' }))).toBe('QR Code Accepted — Finishing Sign-In…');
    expect(loginPhaseMessage(state({ phase: 'password' }))).toBe('Two-Step Verification: Enter Your Telegram Cloud Password');
    expect(loginPhaseMessage(state({ phase: 'unauthorized' }))).toBe('Preparing A Login QR Code…');
  });

  it('reports the engine\u2019s own error rather than a generic sentence', () => {
    expect(loginPhaseMessage(state({ phase: 'error', error: 'FLOOD_WAIT_30' }))).toBe('FLOOD_WAIT_30');
    expect(loginPhaseMessage(state({ phase: 'error' }))).toBe('The Session Engine Reported An Error');
  });

  it('names every code-delivery kind Telegram reports', () => {
    const cases: Array<[string, string]> = [
      ['app', 'Telegram Sent A Login Code To Your Telegram App — Type It Below'],
      ['sms', 'Telegram Sent A Login Code By SMS — Type It Below'],
      ['firebase', 'Telegram Sent A Login Code By SMS — Type It Below'],
      ['fragment', 'Telegram Sent A Login Code By SMS — Type It Below'],
      ['sms_word', 'Telegram Sent A Login Code By SMS — Type It Below'],
      ['sms_phrase', 'Telegram Sent A Login Code By SMS — Type It Below'],
      ['call', 'Telegram Sent A Login Code In A Phone Call — Type It Below'],
      ['flash_call', 'Telegram Sent A Login Code As A Flash Call — Type It Below'],
      ['missed_call', 'Telegram Sent A Login Code As A Missed Call — Type It Below'],
      ['email', 'Telegram Sent A Login Code By Email — Type It Below'],
    ];
    for (const [codeType, expected] of cases) expect(loginPhaseMessage(state({ phase: 'code', codeType })), codeType).toBe(expected);
  });

  it('falls back to the plain sentence for a delivery it does not name', () => {
    expect(loginPhaseMessage(state({ phase: 'code', codeType: 'carrier_pigeon' }))).toBe('Type The Login Code Telegram Sent You');
    expect(loginPhaseMessage(state({ phase: 'code' }))).toBe('Type The Login Code Telegram Sent You');
  });
});
