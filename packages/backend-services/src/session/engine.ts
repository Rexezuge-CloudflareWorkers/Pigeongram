import { CORRELATION_ID_HEADER, ENGINE_PATHS } from '@pigeongram/backend-runtime/constants';
import type { EngineStateDto, MeDto, UpdateEvent } from '../types';
import type { AvatarCache } from './avatar-cache';
import type { EngineConfig } from './config';
import { createEngineContainer, Tokens } from './container';
import type { TelegramDriver } from './driver';
import { EngineError } from './errors';
import { errorResponse, readJsonBody } from './http';
import type { LoginApi } from './login-api';
import type { LoginFlow } from './login-flow';
import type { SessionLifecycle } from './lifecycle';
import { isOriginAllowed, originRejection } from './origin';
import { prepareExclusively } from './platform';
import { log } from './log';
import { avatarResponse, fileResponse, stickerResponse, uploadGroupResponse, uploadResponse } from './media-routes';
import { clampInt } from './params';
import type { PushNotifier } from './push-notifier';
import { parsePushSubscription } from './push-spec';
import type { PushSubscriptions } from './push-subscriptions';
import type { UpdatesSocketHub } from './socket-hub';
import type { EngineStore } from './stats';
import type { StatsDto } from './stats';

/**
Name of the single Durable Object instance that owns the account.
*/
export const ENGINE_OBJECT_NAME = 'main';

/**
One handler in the engine's route table.
*/
type EngineRouteHandler = (request: Request, url: URL) => Response | Promise<Response>;

/**
The routes that keep an idle session warm for a burst of follow-up calls.

The idle release is scheduled in `fetch`'s `finally`, so a refused RPC or a
broken media stream releases the connection just as a successful one does.
The socket upgrade, the wake probe and the login routes are excluded: they
own their own lifecycle.
*/
const ACTIVITY_PATHS: ReadonlySet<string> = new Set([
  '/user/rpc',
  '/user/upload',
  '/user/upload-group',
  '/user/file',
  '/user/avatar',
  '/user/sticker',
]);

/**
The collaborators a test may replace. Production builds them from the DO's
storage and the environment, exactly as before; the seams exist so the
route table, the quota failures and the clock can be exercised without a
real Telegram session.
*/
export interface EngineDeps {
  driver?: TelegramDriver;
  store?: EngineStore;
  avatars?: AvatarCache;
  /**
  The engine's clock. Defaults to `Date.now`; the wake cadence and the
  avatar cache's ordering read it.
  */
  now?: () => number;
  /**
  The device subscriptions the notifier fans out to.
  */
  pushSubscriptions?: PushSubscriptions;
  /**
  The outbound delivery seam, replaceable in tests.
  */
  notifier?: PushNotifier;
}

/**
The session engine: one Durable Object instance owns one Telegram account.

The class is the Durable Object's HTTP surface and the owner of the
account's state; the wake and live lifecycle — the two modes the mtcute
client runs in — lives in `lifecycle.ts`, and the bridge's methods live in
`rpc-methods.ts`.
*/
export class SessionEngine {
  private readonly config: EngineConfig;
  private readonly env: CloudflareEnv;
  private readonly store: EngineStore;
  private readonly avatars: AvatarCache;
  private readonly driver: TelegramDriver;
  private readonly login: LoginFlow;
  private readonly loginApi: LoginApi;
  private readonly hub: UpdatesSocketHub;
  private readonly lifecycle: SessionLifecycle;
  private readonly notifier: PushNotifier;
  private readonly pushSubscriptions: PushSubscriptions;
  private readonly routes: ReadonlyMap<string, EngineRouteHandler>;
  private me: MeDto | null;

  constructor(
    private readonly state: DurableObjectState,
    env: CloudflareEnv,
    deps: EngineDeps = {},
  ) {
    this.env = env;
    const now = deps.now ?? (() => Date.now());
    const container = createEngineContainer(state, env, deps, now, {
      onLoginSettled: (me) => {
        this.me = me;
        this.writeMeta('me', JSON.stringify(me));
        // Disconnecting after a login is a background task: the DO must not
        // drop it when the login request's event ends, and a rejection has to
        // be logged rather than surfacing as an unhandled promise.
        this.lifecycle.background(this.afterLogin());
      },
      onLoginFailed: (error) => log.error('login.failed', { error }),
      stateSnapshot: () => this.stateSnapshot(),
    });
    this.config = container.get(Tokens.config);
    this.store = container.get(Tokens.store);
    this.avatars = container.get(Tokens.avatars);
    this.driver = container.get(Tokens.driver);
    this.lifecycle = container.get(Tokens.lifecycle);
    this.hub = container.get(Tokens.hub);
    this.login = container.get(Tokens.login);
    this.loginApi = container.get(Tokens.loginApi);
    this.notifier = container.get(Tokens.notifier);
    this.pushSubscriptions = container.get(Tokens.pushSubscriptions);
    this.me = readStoredMe(this.store);
    // One table, built once per object: a route is data, not a branch in a
    // switch that has to be kept in step with ENGINE_PATHS by hand.
    this.routes = new Map<string, EngineRouteHandler>([
      ['GET /user/updates', (request) => this.hub.accept(request, this.env)],
      ['GET /user/state', async () => Response.json(await this.stateSnapshot())],
      ['POST /user/login/qr', async () => Response.json(await this.loginApi.startQr())],
      ['POST /user/login/phone', async (request) => Response.json(await this.loginApi.startPhone(request))],
      ['POST /user/login/code', async (request) => Response.json(await this.loginApi.submitCode(request))],
      ['POST /user/login/password', async (request) => Response.json(await this.loginApi.submitPassword(request))],
      ['POST /user/login/cancel', async () => Response.json(await this.loginApi.cancel())],
      ['POST /user/logout', async () => Response.json(await this.logout())],
      ['POST /user/rpc', async (request) => Response.json(await this.rpc(request))],
      ['POST /user/upload', (request, url) => uploadResponse(this.driver, request, url, this.config)],
      ['POST /user/upload-group', (request, url) => uploadGroupResponse(this.driver, request, url, this.config)],
      ['POST /user/wake', async () => Response.json(await this.lifecycle.runWake('manual'))],
      ['POST /user/push/subscribe', async (request) => Response.json(await this.pushSubscribe(request))],
      ['POST /user/push/unsubscribe', async (request) => Response.json(await this.pushUnsubscribe(request))],
      ['GET /user/stats', (_request, url) => Promise.resolve(Response.json(this.stats(url)))],
      ['GET /user/file', (request, url) => fileResponse(this.driver, request, url)],
      ['HEAD /user/file', (request, url) => fileResponse(this.driver, request, url)],
      ['GET /user/avatar', (request, url) => avatarResponse(this.driver, this.avatars, url, request.method)],
      ['HEAD /user/avatar', (request, url) => avatarResponse(this.driver, this.avatars, url, request.method)],
      ['GET /user/sticker', (_request, url) => stickerResponse(this.driver, url, 'GET')],
      ['HEAD /user/sticker', (_request, url) => stickerResponse(this.driver, url, 'HEAD')],
    ]);
    this.driver.onEvent((event) => {
      this.handleEvent(event);
    });
    this.warmUp();
  }

  /**
  Prepares the mtcute storage before the first event is dispatched.
  
  The Durable Object hands out one event at a time, so the migrations the
  storage needs would otherwise be the first thing every cold request paid
  for. Running them once, while the object is still empty, keeps them off
  the request path.
  */
  private warmUp(): void {
    prepareExclusively(this.state, async () => {
      try {
        await this.driver.prepare();
      } catch (error) {
        // A rejected block resets the object, and a missing credential is a
        // configuration answer, not a crash: the first bridge call reports it.
        log.error('storage.prepare_failed', { error });
      }
    });
  }

  // ---- HTTP surface ------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const correlationId = request.headers.get(CORRELATION_ID_HEADER) ?? crypto.randomUUID();
    const isWebSocketUpgrade = request.method === 'GET' && url.pathname === '/user/updates';
    if ((request.method === 'POST' || isWebSocketUpgrade) && !isOriginAllowed(request, this.env)) {
      const response = originRejection();
      response.headers.set(CORRELATION_ID_HEADER, correlationId);
      return response;
    }
    try {
      // A request is the only chance to repair a cadence that a failed alarm
      // write left behind; an alarm that already exists is left alone.
      await this.lifecycle.ensureArmed();
      try {
        const response = await this.route(request, url);
        response.headers.set(CORRELATION_ID_HEADER, correlationId);
        return response;
      } finally {
        if (ACTIVITY_PATHS.has(url.pathname)) await this.lifecycle.afterActivity();
      }
    } catch (error) {
      const response = errorResponse(error, correlationId);
      response.headers.set(CORRELATION_ID_HEADER, correlationId);
      return response;
    }
  }

  private route(request: Request, url: URL): Promise<Response> {
    const handler = this.routes.get(`${request.method} ${url.pathname}`);
    if (handler) return Promise.resolve(handler(request, url));
    if (ENGINE_PATHS.has(url.pathname)) throw new EngineError('Method not allowed', 405);
    throw new EngineError('Not found', 404);
  }

  /**
  The verb/path pairs this object serves, for the route-table cross-check.
  */
  get routeKeys(): readonly string[] {
    return [...this.routes.keys()];
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
    return this.driver.rpc(method, body.params);
  }

  private stats(url: URL): StatsDto {
    const days = url.searchParams.has('days') ? clampInt(Number(url.searchParams.get('days')), 1, 30, 7) : 7;
    return this.store.stats(days);
  }

  /**
  Registers (or refreshes) one browser device. The subscription is a secret
  as much as a Telegram session is, so it lives behind the same Access gate
  as the rest of `/user/*` and is never echoed back to a caller.
  */
  private async pushSubscribe(request: Request): Promise<{ ok: true }> {
    const subscription = parsePushSubscription(await readJsonBody(request));
    this.pushSubscriptions.upsert(subscription);
    return { ok: true };
  }

  private async pushUnsubscribe(request: Request): Promise<{ ok: true }> {
    const body = await readJsonBody(request);
    if (typeof body.endpoint !== 'string' || body.endpoint.length === 0) {
      throw new EngineError('Missing push endpoint', 400, 'validation');
    }
    this.pushSubscriptions.remove(body.endpoint);
    return { ok: true };
  }

  private async logout(): Promise<{ ok: true }> {
    this.login.cancel();
    // A signed-out account must not keep receiving notifications from the
    // browser that just left it. Deletes are writes, but logout is already a
    // write path and the subscription table is tiny.
    this.pushSubscriptions.clear();
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
    this.writeMeta('me', null);
    await this.lifecycle.armWake();
    return { ok: true };
  }

  /**
  Persists the signed-in user, best effort.
  
  `engine_meta` is a convenience: the session is already in mtcute's
  storage, and the snapshot can be read from Telegram again. With the Free
  plan's daily write budget exhausted, a rejected write must not turn a
  successful login or logout into a failed one.
  */
  private writeMeta(key: string, value: string | null): void {
    try {
      this.store.writeMeta(key, value);
    } catch (error) {
      log.warn('meta.write_failed', { key, error });
    }
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
    this.lifecycle.countUpdate();
    if (!event) return;
    if (this.lifecycle.isLive) {
      this.hub.broadcast({ type: 'update', update: event });
      return;
    }
    // No tab is attached: a wake still sees missed messages through
    // getDifference. This is the only moment a system notification is useful.
    this.notifier.offer(event);
  }
}

function readStoredMe(store: EngineStore): MeDto | null {
  const raw = store.readMeta('me');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MeDto;
  } catch (error) {
    // A corrupt snapshot is not worth a delete (deletes are writes on the
    // Free plan): the next `/user/state` reads the account from Telegram and
    // writes a fresh one.
    log.warn('profile.snapshot_corrupt', { error });
    return null;
  }
}
