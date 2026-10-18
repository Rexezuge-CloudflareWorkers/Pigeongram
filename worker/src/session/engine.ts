import type { EngineStateDto, MeDto, UpdateEvent } from '../types';
import { TelegramDriver } from './driver';
import { EngineError } from './errors';
import { errorResponse, readJsonBody } from './http';
import { LoginApi } from './login-api';
import { LoginFlow } from './login-flow';
import { avatarResponse, fileResponse, uploadResponse } from './media-routes';
import { clampInt } from './params';
import { UpdatesSocketHub } from './socket-hub';
import { EngineStore } from './stats';
import type { StatsDto, WakeCountersDto, WakeRecord } from './stats';

/**
Name of the single Durable Object instance that owns the account.
*/
export const ENGINE_OBJECT_NAME = 'main';

/**
Default cadence of the wake alarm, in seconds (overridable by var).
*/
const DEFAULT_WAKE_INTERVAL_SECONDS = 300;

/**
How long a wake may spend catching up before it disconnects anyway.
*/
const CATCH_UP_TIMEOUT_MS = 25_000;

/**
 * How long an idle session is kept for follow-up RPCs before the idle alarm
 * runs a wake (which ends in a disconnect).
 */
const IDLE_RELEASE_MS = 60_000;

/**
 * The session engine: one Durable Object instance owns one Telegram account.
 *
 * Two modes drive the mtcute client:
 *
 * - **Wake** — the 5-minute alarm connects, replays `getDifference` through
 *   mtcute's updates manager, records a row in `engine_wakes`, disconnects and
 *   re-arms. This is the always-reachable baseline (no presence).
 * - **Live** — while at least one browser socket is attached, the client stays
 *   connected, updates are broadcast as they arrive, and RPCs ride the same
 *   connection. When the last socket closes the client disconnects and the
 *   wake cadence resumes.
 *
 * A short idle alarm keeps a session around for a burst of bridge calls, then
 * runs a wake so the connection is released promptly.
 */
export class SessionEngine {
  private readonly store: EngineStore;
  private readonly driver: TelegramDriver;
  private readonly login: LoginFlow;
  private readonly loginApi: LoginApi;
  private readonly hub: UpdatesSocketHub;
  private me: MeDto | null;
  private rawUpdates = 0;
  private live = false;
  private liveTask: Promise<void> | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CloudflareEnv,
  ) {
    this.store = new EngineStore(state.storage.sql);
    this.driver = new TelegramDriver(env, state.storage);
    this.me = readStoredMe(this.store);
    this.hub = new UpdatesSocketHub(state, {
      ensureLive: () => this.ensureLive(),
      stopLive: () => this.stopLive(),
    });
    this.login = new LoginFlow(
      this.driver,
      (me) => {
        this.me = me;
        this.store.writeMeta('me', JSON.stringify(me));
        void this.afterLogin();
      },
      (error) => {
        console.error('[engine] login failed', error);
      },
    );
    this.loginApi = new LoginApi(this.login, () => this.stateSnapshot());
    this.driver.onEvent((event) => {
      this.handleEvent(event);
    });
  }

  // ---- HTTP surface ------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      return await this.route(request, url);
    } catch (error) {
      return errorResponse(error);
    }
  }

  private async route(request: Request, url: URL): Promise<Response> {
    switch (`${request.method} ${url.pathname}`) {
      case 'GET /api/updates': {
        return this.hub.accept();
      }
      case 'GET /api/state': {
        return Response.json(await this.stateSnapshot());
      }
      case 'POST /api/login/qr': {
        return Response.json(await this.loginApi.startQr());
      }
      case 'POST /api/login/phone': {
        return Response.json(await this.loginApi.startPhone(request));
      }
      case 'POST /api/login/code': {
        return Response.json(await this.loginApi.submitCode(request));
      }
      case 'POST /api/login/password': {
        return Response.json(await this.loginApi.submitPassword(request));
      }
      case 'POST /api/login/cancel': {
        return Response.json(await this.loginApi.cancel());
      }
      case 'POST /api/logout': {
        return Response.json(await this.logout());
      }
      case 'POST /api/rpc': {
        return Response.json(await this.rpc(request));
      }
      case 'POST /api/upload': {
        const response = await uploadResponse(this.driver, request, url, this.env);
        this.afterActivity();
        return response;
      }
      case 'POST /api/wake': {
        return Response.json(await this.runWake('manual'));
      }
      case 'GET /api/stats': {
        return Response.json(this.stats(url));
      }
      case 'GET /api/file': {
        const response = await fileResponse(this.driver, request, url);
        this.afterActivity();
        return response;
      }
      case 'GET /api/avatar': {
        const response = await avatarResponse(this.driver, url);
        this.afterActivity();
        return response;
      }
      default: {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }
    }
  }

  private async stateSnapshot(): Promise<EngineStateDto> {
    let authorized = false;
    let configError: string | undefined;
    try {
      authorized = await this.driver.isAuthorized();
    } catch (error) {
      configError = error instanceof Error ? error.message : String(error);
    }
    if (configError !== undefined) {
      return { phase: 'error', authorized: false, me: null, error: configError };
    }
    if (authorized) {
      return { phase: 'authorized', authorized: true, me: this.me };
    }
    return { authorized: false, me: null, ...this.login.snapshot() };
  }

  private async rpc(request: Request): Promise<unknown> {
    const body = await readJsonBody(request);
    const method = body.method;
    if (typeof method !== 'string' || method.length === 0) {
      throw new EngineError('method must be a non-empty string', 400);
    }
    const result = await this.driver.rpc(method, body.params);
    this.afterActivity();
    return result;
  }

  private stats(url: URL): StatsDto {
    const days = url.searchParams.has('days') ? clampInt(Number(url.searchParams.get('days')), 1, 30, 7) : 7;
    return this.store.stats(days);
  }

  private async logout(): Promise<{ ok: true }> {
    this.login.cancel();
    this.live = false;
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.close(4001, 'logged out');
      } catch {
        // Already closing; nothing to do.
      }
    }
    await this.driver.logout();
    this.me = null;
    this.store.writeMeta('me', null);
    await this.arm(this.wakeIntervalMs());
    return { ok: true };
  }

  // ---- Wake / live lifecycle --------------------------------------------

  async alarm(): Promise<void> {
    if (this.login.running) {
      await this.arm(IDLE_RELEASE_MS);
      return;
    }
    if (this.state.getWebSockets().length > 0) {
      await this.ensureLive();
      return;
    }
    await this.runWake('alarm');
  }

  private async runWake(reason: 'alarm' | 'manual'): Promise<WakeCountersDto> {
    const before = this.rawUpdates;
    const startedAt = Date.now();
    let ok = true;
    let error: string | null = null;
    try {
      if (await this.driver.isAuthorized()) {
        await this.driver.connect();
        await this.driver.catchUp(CATCH_UP_TIMEOUT_MS);
        if (!this.live) await this.driver.disconnect();
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
        await this.driver.disconnect();
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
    this.store.recordWake(record);
    if (!this.live) await this.arm(this.wakeIntervalMs());
    return this.store.counters();
  }

  /**
  Joins the live session. Concurrent callers (`accept` plus `hello`) share one
  attempt, and an attempt that discovers the last socket left mid-connect tears
  the connection down instead of going live.
  */
  private async ensureLive(): Promise<void> {
    this.liveTask ??= this.startLive().finally(() => {
      this.liveTask = null;
    });
    return this.liveTask;
  }

  private async startLive(): Promise<void> {
    this.live = true;
    try {
      if (!(await this.driver.isAuthorized())) {
        // An unsigned-in client must never reach the updates loop: without a
        // DC it fails fast, and mtcute restarts that loop without backoff.
        this.live = false;
        console.info('[engine] live session refused: not signed in');
        this.hub.broadcast({ type: 'error', message: 'Not signed in' });
        return;
      }
      await this.driver.connect();
      if (!this.live) {
        if (!this.login.running) await this.driver.disconnect();
        return;
      }
      await this.driver.catchUp(CATCH_UP_TIMEOUT_MS);
      await this.arm(this.wakeIntervalMs());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[engine] live session failed', error);
      this.live = false;
      if (!this.login.running) {
        try {
          await this.driver.disconnect();
        } catch {
          // The connection is already broken; the next connect rebuilds it.
        }
      }
      this.hub.broadcast({ type: 'error', message });
      await this.arm(this.wakeIntervalMs());
    }
  }

  private async stopLive(): Promise<void> {
    this.live = false;
    const pending = this.liveTask;
    if (pending) {
      try {
        await pending;
      } catch {
        // `startLive` reports its own failures to the sockets.
      }
    }
    if (!this.login.running) {
      try {
        await this.driver.disconnect();
      } catch {
        // The connection is already broken; the next wake rebuilds it.
      }
    }
    await this.arm(this.wakeIntervalMs());
  }

  /**
  Detaches the RPC connection shortly after the last bridge call.
  */
  private afterActivity(): void {
    void this.arm(this.live ? this.wakeIntervalMs() : IDLE_RELEASE_MS);
  }

  private async afterLogin(): Promise<void> {
    try {
      await this.driver.disconnect();
    } catch {
      // The session is already persisted; the next wake reconnects.
    }
    await this.arm(this.wakeIntervalMs());
  }

  private wakeIntervalMs(): number {
    const parsed = Number(this.env.WAKE_INTERVAL_SECONDS ?? '');
    const seconds = Number.isFinite(parsed) && parsed >= 30 ? parsed : DEFAULT_WAKE_INTERVAL_SECONDS;
    return Math.round(seconds * 1000);
  }

  private async arm(delayMs: number): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + Math.max(1000, delayMs));
  }

  // ---- Updates fan-out ---------------------------------------------------

  /**
  Hibernation-API entry points; the protocol lives in `socket-hub.ts`.
  */
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.hub.onMessage(socket, message);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.hub.onClose(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.hub.onClose(socket);
  }

  private handleEvent(event: UpdateEvent | null): void {
    this.rawUpdates += 1;
    if (!event || !this.live) return;
    this.hub.broadcast({ type: 'update', update: event });
  }
}

function readStoredMe(store: EngineStore): MeDto | null {
  const raw = store.readMeta('me');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MeDto;
  } catch {
    return null;
  }
}
