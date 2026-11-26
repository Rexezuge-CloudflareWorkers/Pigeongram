import { describe, expect, it } from 'vitest';
import { EngineStore } from '../../packages/backend-services/src/session/stats';
import { createNodeSqlStorage, openNodeDatabase } from './node-sql';

/**
The wake log is a Free-plan budget consumer as well as a soak metric. It
must read the same injected clock as the lifecycle that measured the wake,
otherwise a fake-clock test (or a clock correction) writes a timestamp that
disagrees with the duration in the same row.
*/
function store(now: () => number): EngineStore {
  return new EngineStore(createNodeSqlStorage(openNodeDatabase()), now);
}

describe('EngineStore', () => {
  it('stamps a wake with the injected clock', () => {
    const clock = store(() => 1_700_000_000_000);
    clock.recordWake({ reason: 'alarm', durationMs: 12.4, updates: 3, ok: true });

    expect(clock.counters()).toMatchObject({
      totalWakes: 1,
      avgWakeMs: 12,
      updatesSeen: 3,
      lastWakeAt: 1_700_000_000_000,
    });
  });

  it('uses the same clock for the daily window', () => {
    const nowAt = { value: Date.UTC(2026, 10, 26, 12) };
    const clock = store(() => nowAt.value);
    clock.recordWake({ reason: 'alarm', durationMs: 5, updates: 1, ok: true });

    expect(clock.daily(7)).toHaveLength(1);
    nowAt.value += 9 * 24 * 60 * 60 * 1000;
    expect(clock.daily(7)).toHaveLength(0);
  });

  it('keeps failed wakes and counts them separately', () => {
    const clock = store(() => 1_700_000_000_000);
    clock.recordWake({ reason: 'alarm', durationMs: 10, updates: 0, ok: false, error: 'offline' });
    clock.recordWake({ reason: 'manual', durationMs: 20, updates: 2, ok: true });

    expect(clock.counters()).toMatchObject({ totalWakes: 2, failedWakes: 1, updatesSeen: 2 });
    expect(clock.daily(7)[0]).toMatchObject({ day: '2023-11-14', wakes: 2, failures: 1 });
  });
});
