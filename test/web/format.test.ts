import { describe, expect, it } from 'vitest';
import { formatPresence } from '../../apps/web/src/format';

describe('formatPresence', () => {
  it('reads an online person as online', () => {
    expect(formatPresence({ status: 'online', lastSeenAt: null })).toBe('Online');
  });

  it('names the day and the hour of the last sighting', () => {
    const seen = Date.now() - 60_000;
    expect(formatPresence({ status: 'offline', lastSeenAt: seen })).toMatch(/^Last Seen (Today|Yesterday) At /);
  });

  it('falls back to the coarse state when Telegram hides the time', () => {
    expect(formatPresence({ status: 'offline', lastSeenAt: null })).toBe('Last Seen Recently');
    expect(formatPresence({ status: 'recently', lastSeenAt: null })).toBe('Last Seen Recently');
    expect(formatPresence({ status: 'within_week', lastSeenAt: null })).toBe('Last Seen Within A Week');
    expect(formatPresence({ status: 'within_month', lastSeenAt: null })).toBe('Last Seen Within A Month');
  });

  it('answers nothing for a peer without a presence', () => {
    expect(formatPresence(null)).toBeNull();
  });
});
