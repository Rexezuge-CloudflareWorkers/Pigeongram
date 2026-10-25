import type { TelegramDriver } from './driver';
import type { LoginFlow } from './login-flow';
import type { UpdatesSocketHub } from './socket-hub';
import type { EngineStore, WakeCountersDto, WakeRecord } from './stats';

/**
Default cadence of the wake alarm, in seconds (overridable by var).
*/
export const DEFAULT_WAKE_INTERVAL_SECONDS = 300;

/**
How long a wake may spend catching up before it disconnects anyway.
*/
export const CATCH_UP_TIMEOUT_MS = 25_000;

/**
How long an idle session is kept for follow-up RPCs before the idle alarm
runs a wake (which ends in a disconnect).
*/
export const IDLE_RELEASE_MS = 60_000;

/**
How long `stopLive` waits for a replay that is still running before it drops
the connection anyway. The replay settles on its own (it has its own
timeout); holding the socket-close event for it queues every bridge call
behind `getDifference`.
*/
export const STOP_CATCH_UP_TIMEOUT_MS = 2000;

/**
The collaborators the lifecycle drives.
*/
export interface LifecycleHost {
  driver: TelegramDriver;
  hub: UpdatesSocketHub;
  login: LoginFlow;
  state: DurableObjectState;
  store: EngineStore;
  env: CloudflareEnv;
}

/**
The session engine's wake and live lifecycle.
 *
 * Two modes drive the mtcute client:
 *
 * - **Wake** — the alarm connects, replays `getDifference` through mtcute's
 *   updates manager, records a row in `engine_wakes`, disconnects and re-arms.
 *   This is the always-reachable baseline (no presence).
 * - **Live** — while at least one browser socket is attached, the client stays
 *   connected, updates are broadcast as they arrive, and RPCs ride the same
 *   connection. When the last socket closes the client disconnects and the
 *   wake cadence resumes.
 *
 * A short idle alarm keeps a session around for a burst of bridge calls, then
 * runs a wake so the connection is released promptly.
 *
 * The Durable Object hands out one event at a time, so how long a piece of
 * this work holds the object decides how long every bridge call waits behind
 * it. The replay of the missed updates is the longest piece, and it runs
 * outside the gate for exactly that reason.
 */
export class SessionLifecycle {
  private live = false;
  private liveTask: Promise<void> | null = null;
  private catchUpTask: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private rawUpdates = 0;

  constructor(private readonly host: LifecycleHost) {}

  /**
  Whether the client is connected for the browser's sake (live mode).
  */
  get isLive(): boolean {
    return this.live;
  }

  /**
  Counts a raw update, live or not: the wake log's figure is the true
  Telegram traffic, whatever the session was doing.
  */
  countUpdate(): void {
    this.rawUpdates += 1;
  }

  async alarm(): Promise<void> {
    if (this.host.login.running) {
      await this.arm(IDLE_RELEASE_MS);
      return;
    }
    if (this.host.state.getWebSockets().length > 0) {
      await this.ensureLive();
      return;
    }
    await this.runWake('alarm');
  }

  /**
  Connects, replays what was missed, records the wake and disconnects again.
  */
  async runWake(reason: 'alarm' | 'manual'): Promise<WakeCountersDto> {
    const before = this.rawUpdates;
    const startedAt = Date.now();
    let ok = true;
    let error: string | null = null;
    try {
      if (await this.host.driver.isAuthorized()) {
        await this.host.driver.connect();
        await this.host.driver.catchUp(CATCH_UP_TIMEOUT_MS);
        if (!this.live && !this.host.driver.hasActiveCall) await this.host.driver.disconnect();
      } else {
        // Nothing to replay before the account is linked, and an anonymous
        // client has no DC to run against — so the wake stays a no-op and the
        // alarm cadence remains observable through the wake log.
        console.info('[engine] wake skipped: not signed in');
      }
    } catch (failure) {
      ok = false;
      error = failure instanceof Error ? failure.message : String(failure);
      try {
        await this.host.driver.disconnect();
      } catch {
        // The connection is already broken; the next wake rebuilds it.
      }
    }
    const record: WakeRecord = {
      reason,
      durationMs: Date.now() - startedAt,
      updates: this.rawUpdates - before,
      ok,
      error,
    };
    try {
      this.host.store.recordWake(record);
    } catch (failure) {
      // The wake log is bookkeeping: a rejected write (the Free plan's daily
      // row budget is exhausted) must not fail the wake that produced it.
      console.error('[engine] failed to record the wake', failure);
    }
    if (!this.live) await this.arm(this.wakeIntervalMs());
    return this.host.store.counters();
  }

  /**
  Joins the live session. Concurrent callers (`accept` plus `hello`) share one
  attempt, and an attempt that discovers the last socket left mid-connect tears
  the connection down instead of going live.
  */
  async ensureLive(): Promise<void> {
    this.liveTask ??= this.startLive().finally(() => {
      this.liveTask = null;
    });
    return this.liveTask;
  }

  /**
  Marks the session as no longer live, without touching the connection.
  */
  detach(): void {
    this.live = false;
  }

  /**
  Re-arms the wake cadence.
  */
  async armWake(): Promise<void> {
    await this.arm(this.wakeIntervalMs());
  }

  /**
  Repairs a missing alarm without disturbing one that is already scheduled.

  A rejected write (the Free plan's row budget) can leave the object with no
  alarm at all; the next request then has to restore the cadence, or the
  engine stays asleep until someone opens the app.
  */
  async ensureArmed(): Promise<void> {
    await this.armWake();
  }

  /**
  Detaches the RPC connection shortly after the last bridge call.

  Awaited by the bridge routes: the storage write has to outlive the event that
  requested it, or the object may hibernate before the alarm is scheduled.
  */
  async afterActivity(): Promise<void> {
    await this.arm(this.live ? this.wakeIntervalMs() : IDLE_RELEASE_MS);
  }

  async afterLogin(): Promise<void> {
    try {
      await this.host.driver.disconnect();
    } catch {
      // The session is already persisted; the next wake reconnects.
    }
    await this.arm(this.wakeIntervalMs());
  }

  private async startLive(): Promise<void> {
    this.live = true;
    try {
      if (!(await this.host.driver.isAuthorized())) {
        // An unsigned-in client must never reach the updates loop: without a
        // DC it fails fast, and mtcute restarts that loop without backoff.
        this.live = false;
        console.info('[engine] live session refused: not signed in');
        this.host.hub.broadcast({ type: 'error', message: 'Not signed in' });
        return;
      }
      await this.host.driver.connect();
      if (!this.live) {
        if (!this.host.login.running) await this.host.driver.disconnect();
        return;
      }
      // The replay of the missed updates runs outside the input gate. It is
      // the longest event in the system — a `getDifference` over a long
      // absence — and holding the gate for it would queue every bridge call
      // behind it. The connection is already up, so a call that arrives now
      // rides the same connection.
      this.catchUpTask = this.host.driver.catchUp(CATCH_UP_TIMEOUT_MS);
      this.background(this.catchUpTask);
      await this.arm(this.wakeIntervalMs());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[engine] live session failed', error);
      this.live = false;
      if (!this.host.login.running) {
        try {
          await this.host.driver.disconnect();
        } catch {
          // The connection is already broken; the next connect rebuilds it.
        }
      }
      this.host.hub.broadcast({ type: 'error', message });
      await this.arm(this.wakeIntervalMs());
    }
  }

  /**
   * Runs work outside the input gate.
   *
   * The Durable Object waits for a promise passed to `waitUntil` before it
   * may be evicted, so the work still finishes — it just no longer holds the
   * object hostage while it runs.
   */
  private background(work: Promise<unknown>): void {
    const settled = work.catch((error) => {
      console.error('[engine] background work failed', error);
    });
    const holder = this.host.state as unknown as { waitUntil?: (promise: Promise<unknown>) => void };
    if (typeof holder.waitUntil === 'function') {
      holder.waitUntil(settled);
      return;
    }
    void settled;
  }

  /**
  Leaves the live session: the connection is dropped and the wake cadence
  resumes. The socket hub calls it when the last browser socket closes.

  A call keeps the connection — see the guard below. The method is idempotent
  because `webSocketError` and `webSocketClose` can both run for one socket,
  and tearing down twice would arm the alarm twice and race two disconnects.
  */
  async stopLive(): Promise<void> {
    this.stopping ??= this.#stopLive().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  async #stopLive(): Promise<void> {
    this.live = false;
    const pending = this.liveTask;
    if (pending) {
      try {
        await pending;
      } catch {
        // `startLive` reports its own failures to the sockets.
      }
    }
    // The replay may still be running. Its own timeout eventually settles it,
    // but the socket-close event must not wait up to CATCH_UP_TIMEOUT_MS: the
    // input gate would queue every bridge call behind it. Give it a moment,
    // then disconnect under it.
    const catchUp = this.catchUpTask;
    this.catchUpTask = null;
    if (catchUp) await settleWithin(catchUp, STOP_CATCH_UP_TIMEOUT_MS);
    if (this.host.driver.hasActiveCall) {
      // The connection stays up for the call: the signalling between the two
      // peers rides it, and the browser that just lost its socket is about to
      // come back and find the call still up. The wake cadence is re-armed so
      // the alarm finds the session connected rather than starting a second
      // one.
      await this.arm(this.wakeIntervalMs());
      return;
    }
    if (!this.host.login.running) {
      try {
        await this.host.driver.disconnect();
      } catch {
        // The connection is already broken; the next wake rebuilds it.
      }
    }
    await this.arm(this.wakeIntervalMs());
  }

  private wakeIntervalMs(): number {
    const parsed = Number(this.host.env.WAKE_INTERVAL_SECONDS ?? '');
    const seconds = Number.isFinite(parsed) && parsed >= 30 ? parsed : DEFAULT_WAKE_INTERVAL_SECONDS;
    return Math.round(seconds * 1000);
  }

  private async arm(delayMs: number): Promise<void> {
    const target = Date.now() + Math.max(1000, delayMs);
    try {
      // `setAlarm` is a row write on the Free plan, and a chat-list load makes
      // one bridge call per avatar. An alarm already at or before the target
      // fires soon enough; re-setting it would only add writes.
      const existing = await this.host.state.storage.getAlarm();
      if (existing !== null && existing <= target) return;
      await this.host.state.storage.setAlarm(target);
    } catch (error) {
      // The cadence is best effort: if the write budget is exhausted, reads
      // still work, and the next request's `ensureArmed` repairs the alarm
      // once the quota resets.
      console.error('[engine] failed to arm the wake alarm', error);
    }
  }
}

/**
Waits at most `ms` for `work`, swallowing its outcome: the caller is tearing
the connection down either way, and the work reports its own failure.
*/
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const settle = (): void => {
      clearTimeout(timer);
      resolve();
    };
    void work.then(settle).catch(settle);
  });
}
