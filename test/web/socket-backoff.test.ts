import { describe, expect, it } from 'vitest';
import { reconnectDelay } from '../../apps/web/src/socket-backoff';

describe('reconnectDelay', () => {
  it('starts near half a second and grows exponentially', () => {
    expect(reconnectDelay(1, 0.5)).toBe(1000);
    expect(reconnectDelay(2, 0.5)).toBe(2000);
    expect(reconnectDelay(3, 0.5)).toBe(4000);
  });

  it('caps the growth so a long outage cannot schedule an endless wait', () => {
    expect(reconnectDelay(20, 0.5)).toBe(15_000);
    expect(reconnectDelay(1000, 0.5)).toBe(15_000);
  });

  it('spreads reconnects by at most twenty percent', () => {
    expect(reconnectDelay(2, 0)).toBe(1600);
    expect(reconnectDelay(2, 1)).toBe(2400);
  });
});
