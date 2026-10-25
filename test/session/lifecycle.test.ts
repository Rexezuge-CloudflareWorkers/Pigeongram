import { afterEach, describe, expect, it, vi } from 'vitest';
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

function harness(): Harness {
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
      getAlarm: async () => alarms.at(-1) ?? null,
      setAlarm: async (time: number) => {
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
    env: { WAKE_INTERVAL_SECONDS: '300' },
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
