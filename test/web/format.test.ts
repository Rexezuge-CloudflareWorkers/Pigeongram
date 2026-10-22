import { describe, expect, it } from 'vitest';
import { formatPresence } from '../../pages/src/format';

describe('formatPresence', () => {
  it('reads an online person as online', () => {
    expect(formatPresence({ status: 'online', lastSeenAt: null })).toBe('online');
  });

  it('names the day and the hour of the last sighting', () => {
    const seen = Date.now() - 60_000;
    expect(formatPresence({ status: 'offline', lastSeenAt: seen })).toMatch(/^last seen (today|yesterday) at /);
  });

  it('falls back to the coarse state when Telegram hides the time', () => {
    expect(formatPresence({ status: 'offline', lastSeenAt: null })).toBe('last seen recently');
    expect(formatPresence({ status: 'recently', lastSeenAt: null })).toBe('last seen recently');
    expect(formatPresence({ status: 'within_week', lastSeenAt: null })).toBe('last seen within a week');
    expect(formatPresence({ status: 'within_month', lastSeenAt: null })).toBe('last seen within a month');
  });

  it('answers nothing for a peer without a presence', () => {
    expect(formatPresence(null)).toBeNull();
  });
});
