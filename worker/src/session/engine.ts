import type { EngineStateDto, MeDto, UpdateEvent } from '../types';
import { AvatarCache } from './avatar-cache';
import { TelegramDriver } from './driver';
import { EngineError } from './errors';
import { errorResponse, readJsonBody } from './http';
import { LoginApi } from './login-api';
import { LoginFlow } from './login-flow';
import { SessionLifecycle } from './lifecycle';
import { avatarResponse, fileResponse, uploadGroupResponse, uploadResponse } from './media-routes';
import { clampInt } from './params';
import { UpdatesSocketHub } from './socket-hub';
import { EngineStore } from './stats';
import type { StatsDto } from './stats';

/**
Name of the single Durable Object instance that owns the account.
*/
export const ENGINE_OBJECT_NAME = 'main';

/**
 * The session engine: one Durable Object instance owns one Telegram account.
 *
 * The class is the Durable Object's HTTP surface and the owner of the
 * account's state; the wake and live lifecycle — the two modes the mtcute
 * client runs in — lives in `lifecycle.ts`, and the bridge's methods live in
 * `rpc.ts`.
 */
export class SessionEngine {
  private readonly store: EngineStore;
  private readonly avatars: AvatarCache;
  private readonly driver: TelegramDriver;
  private readonly login: LoginFlow;
  private readonly loginApi: LoginApi;
  private readonly hub: UpdatesSocketHub;
  private readonly lifecycle: SessionLifecycle;
  private me: MeDto | null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CloudflareEnv,
  ) {
    this.store = new EngineStore(state.storage.sql);
    this.avatars = new AvatarCache(state.storage.sql);
    this.driver = new TelegramDriver(env, state.storage);
    this.me = readStoredMe(this.store);
    this.hub = new UpdatesSocketHub(state, {
      ensureLive: () => this.lifecycle.ensureLive(),
      stopLive: () => this.lifecycle.stopLive(),
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
    this.lifecycle = new SessionLifecycle({
      driver: this.driver,
      hub: this.hub,
      login: this.login,
      state,
      store: this.store,
      env,
    });
    this.driver.onEvent((event) => {
      this.handleEvent(event);
    });
    this.warmUp();
  }

  /**
   * Prepares the mtcute storage before the first event is dispatched.
   *
   * The Durable Object hands out one event at a time, so the migrations the
   * storage needs would otherwise be the first thing every cold request paid
   * for. Running them once, while the object is still empty, keeps them off
   * the request path.
   */
  private warmUp(): void {
    const blocking = this.state as unknown as { blockConcurrencyWhile?: <T>(callback: () => Promise<T>) => Promise<T> };
    if (typeof blocking.blockConcurrencyWhile !== 'function') {
      // The storage prepares itself lazily on the first call; the block is an
      // optimization, not a requirement.
      return;
    }
    void blocking.blockConcurrencyWhile(async () => {
      try {
        await this.driver.prepare();
      } catch (error) {
        // A rejected block resets the object, and a missing credential is a
        // configuration answer, not a crash: the first bridge call reports it.
        console.error('[engine] storage preparation failed', error);
      }
    });
  }

  // ---- HTTP surface ------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      // A request is the only chance to repair a cadence that a failed alarm
      // write left behind; an alarm that already exists is left alone.
      await this.lifecycle.ensureArmed();
      return await this.route(request, url);
    } catch (error) {
      return errorResponse(error);
    }
  }

  private async route(request: Request, url: URL): Promise<Response> {
    switch (`${request.method} ${url.pathname}`) {
      case 'GET /user/updates': {
        return this.hub.accept();
      }
      case 'GET /user/state': {
        return Response.json(await this.stateSnapshot());
      }
      case 'POST /user/login/qr': {
        return Response.json(await this.loginApi.startQr());
      }
      case 'POST /user/login/phone': {
        return Response.json(await this.loginApi.startPhone(request));
      }
      case 'POST /user/login/code': {
        return Response.json(await this.loginApi.submitCode(request));
      }
      case 'POST /user/login/password': {
        return Response.json(await this.loginApi.submitPassword(request));
      }
      case 'POST /user/login/cancel': {
        return Response.json(await this.loginApi.cancel());
      }
      case 'POST /user/logout': {
        return Response.json(await this.logout());
      }
      case 'POST /user/rpc': {
        return Response.json(await this.rpc(request));
      }
      case 'POST /user/upload': {
        const response = await uploadResponse(this.driver, request, url, this.env);
        await this.lifecycle.afterActivity();
        return response;
      }
      case 'POST /user/upload-group': {
        const response = await uploadGroupResponse(this.driver, request, url, this.env);
        await this.lifecycle.afterActivity();
        return response;
      }
      case 'POST /user/wake': {
        return Response.json(await this.lifecycle.runWake('manual'));
      }
      case 'GET /user/stats': {
        return Response.json(this.stats(url));
      }
      case 'GET /user/file': {
        const response = await fileResponse(this.driver, request, url);
        await this.lifecycle.afterActivity();
        return response;
      }
      case 'GET /user/avatar': {
        const response = await avatarResponse(this.driver, this.avatars, url);
        await this.lifecycle.afterActivity();
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
    await this.lifecycle.afterActivity();
    return result;
  }

  private stats(url: URL): StatsDto {
    const days = url.searchParams.has('days') ? clampInt(Number(url.searchParams.get('days')), 1, 30, 7) : 7;
    return this.store.stats(days);
  }

  private async logout(): Promise<{ ok: true }> {
    this.login.cancel();
    this.lifecycle.detach();
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
    await this.lifecycle.armWake();
    return { ok: true };
  }

  // ---- Wake / live lifecycle --------------------------------------------

  async alarm(): Promise<void> {
    await this.lifecycle.alarm();
  }

  private async afterLogin(): Promise<void> {
    await this.lifecycle.afterLogin();
  }

  // ---- Updates fan-out ---------------------------------------------------

  /**
   * Hibernation-API entry points; the protocol lives in `socket-hub.ts`.
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
    this.lifecycle.countUpdate();
    if (!event || !this.lifecycle.isLive) return;
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
