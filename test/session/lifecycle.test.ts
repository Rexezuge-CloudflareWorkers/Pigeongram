import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEngineConfig } from '../../packages/backend-services/src/session/config';
import { SessionLifecycle, STOP_CATCH_UP_TIMEOUT_MS } from '../../packages/backend-services/src/session/lifecycle';
import type { LifecycleHost } from '../../packages/backend-services/src/session/lifecycle';

/**
 * The live session's exit.
 *
 * `stopLive` runs on the socket-close event, which holds the Durable Object's
 * input gate: it must not wait for a `getDifference` replay that may take 25
 * seconds, and a `webSocketError` followed by `webSocketClose` must not tear
 * the connection down twice.
 */

interface Harness {
  lifecycle: SessionLifecycle;
  driver: {
    isAuthorized: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    catchUp: ReturnType<typeof vi.fn>;
    hasActiveCall: boolean;
  };
  login: { running: boolean };
  hub: { broadcast: ReturnType<typeof vi.fn> };
  alarms: number[];
  waitUntil: ReturnType<typeof vi.fn>;
}

interface HarnessOptions {
  /**
  The clock the cadence reads, when a test wants a fixed target.
  */
  now?: () => number;
  /**
  An alarm already scheduled before the lifecycle is built. `undefined`
  keeps the harness's own array as the store.
  */
  existingAlarm?: number | null;
  /**
  Makes `setAlarm` reject, as an exhausted Free-plan write budget does.
  */
  failSetAlarm?: boolean;
  /**
  The cadence var, so a test can drive the bounds.
  */
  wakeIntervalSeconds?: string;
}

function harness(options: HarnessOptions = {}): Harness {
  const alarms: number[] = [];
  const waitUntil = vi.fn();
  const driver = {
    isAuthorized: vi.fn(async () => true),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    catchUp: vi.fn(async () => {}),
    hasActiveCall: false,
  };
  const login = { running: false };
  const hub = { broadcast: vi.fn() };
  const state = {
    getWebSockets: () => [],
    waitUntil,
    storage: {
      getAlarm: async () => (options.existingAlarm === undefined ? (alarms.at(-1) ?? null) : options.existingAlarm),
      setAlarm: async (time: number) => {
        if (options.failSetAlarm) throw new Error('storage write quota exceeded');
        alarms.push(time);
      },
    },
  };
  const store = {
    recordWake: vi.fn(),
    counters: vi.fn(() => ({ totalWakes: 0, failedWakes: 0, avgWakeMs: 0, updatesSeen: 0, lastWakeAt: null })),
  };
  const host = {
    driver,
    hub,
    login,
    state,
    store,
    config: readEngineConfig({ WAKE_INTERVAL_SECONDS: options.wakeIntervalSeconds ?? '300' }),
    now: options.now,
  } as unknown as LifecycleHost;
  return { lifecycle: new SessionLifecycle(host), driver, login, hub, alarms, waitUntil };
}

/**
A promise that never settles, so the replay is still "running".
*/
function pending(): Promise<void> {
  return new Promise(() => {});
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SessionLifecycle.stopLive', () => {
  it('does not wait for a replay past the bounded grace, then disconnects', async () => {
    vi.useFakeTimers();
    const { lifecycle, driver } = harness();
    driver.catchUp.mockImplementation(pending);
    await lifecycle.ensureLive();
    expect(lifecycle.isLive).toBe(true);

    const stopping = lifecycle.stopLive();
    await vi.advanceTimersByTimeAsync(STOP_CATCH_UP_TIMEOUT_MS - 1);
    expect(driver.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(driver.disconnect).toHaveBeenCalledOnce();
    expect(lifecycle.isLive).toBe(false);
  });

  it('is idempotent when close and error both report the last socket', async () => {
    const { lifecycle, driver } = harness();
    await lifecycle.ensureLive();
    await Promise.all([lifecycle.stopLive(), lifecycle.stopLive()]);
    expect(driver.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the connection while a call is up', async () => {
    const { lifecycle, driver, alarms } = harness();
    driver.hasActiveCall = true;
    await lifecycle.ensureLive();
    await lifecycle.stopLive();
    expect(driver.disconnect).not.toHaveBeenCalled();
    expect(alarms.length).toBeGreaterThan(0);
  });

  it('leaves the connection alone while a login is running', async () => {
    const { lifecycle, driver, login } = harness();
    await lifecycle.ensureLive();
    login.running = true;
    await lifecycle.stopLive();
    expect(driver.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects and re-arms the wake cadence without a replay', async () => {
    const { lifecycle, driver, alarms } = harness();
    await lifecycle.ensureLive();
    await lifecycle.stopLive();
    expect(driver.disconnect).toHaveBeenCalledOnce();
    expect(alarms.at(-1)).toBeGreaterThan(Date.now());
  });

  it('reports a failed live start and re-arms', async () => {
    const { lifecycle, driver, hub, alarms } = harness();
    driver.connect.mockRejectedValue(new Error('no DC'));
    await lifecycle.ensureLive();
    expect(lifecycle.isLive).toBe(false);
    expect(hub.broadcast).toHaveBeenCalledWith({ type: 'error', message: 'no DC' });
    expect(alarms.length).toBeGreaterThan(0);
  });

  it('refuses to go live before the account is linked', async () => {
    const { lifecycle, driver, hub } = harness();
    driver.isAuthorized.mockResolvedValue(false);
    await lifecycle.ensureLive();
    expect(driver.connect).not.toHaveBeenCalled();
    expect(hub.broadcast).toHaveBeenCalledWith({ type: 'error', message: 'Not signed in' });
  });
});

describe('SessionLifecycle wake cadence', () => {
  it('arms the next wake from the injected clock', async () => {
    const { lifecycle, alarms } = harness({ now: () => 1_000_000 });

    await lifecycle.armWake();

    expect(alarms).toEqual([1_300_000]);
  });

  it('leaves an alarm that already fires soon enough alone', async () => {
    // `setAlarm` is a row write on the Free plan, so a request that finds an
    // alarm at or before the target must not spend one.
    const { lifecycle, alarms } = harness({ now: () => 1_000_000, existingAlarm: 1_100_000 });

    await lifecycle.ensureArmed();

    expect(alarms).toEqual([]);
  });

  it('replaces an alarm that would fire after the cadence', async () => {
    const { lifecycle, alarms } = harness({ now: () => 1_000_000, existingAlarm: 2_000_000 });

    await lifecycle.ensureArmed();

    expect(alarms).toEqual([1_300_000]);
  });

  it('repairs a missing alarm, which a rejected write can leave behind', async () => {
    const { lifecycle, alarms } = harness({ now: () => 1_000_000, existingAlarm: null });

    await lifecycle.ensureArmed();

    expect(alarms).toEqual([1_300_000]);
  });

  it('falls back to the default cadence for a var below the floor', async () => {
    const { lifecycle, alarms } = harness({ now: () => 1_000_000, wakeIntervalSeconds: '10' });

    await lifecycle.armWake();

    expect(alarms).toEqual([1_300_000]);
  });

  it('swallows a rejected alarm write, so the request still answers', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { lifecycle, alarms } = harness({ now: () => 1_000_000, failSetAlarm: true });

    await expect(lifecycle.armWake()).resolves.toBeUndefined();

    expect(alarms).toEqual([]);
    const line = JSON.parse(logged.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'error',
      event: 'alarm.arm_failed',
      error: { name: 'Error', message: 'storage write quota exceeded' },
    });
  });
});
