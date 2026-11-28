/**
The Durable Object's composition root.

The engine used to hand-wire eight collaborators in its constructor while the
kit's DI container sat unused in `backend-runtime`. This module is that
container's one real consumer: it binds the concrete services once, and the
engine resolves them. Tests keep replacing a collaborator through
`EngineDeps`; production gets the same objects from the same bindings.

The hub and the login flow close over the lifecycle, which in turn needs both
of them. Those closures call `container.get` lazily, after construction, so
the cycle is resolved by the container's singleton memoization rather than by
a partially built object.
*/

import { Container } from '@pigeongram/backend-runtime/di';
import type { Token } from '@pigeongram/backend-runtime/di';
import type { EngineStateDto, MeDto } from '../types';
import { AvatarCache } from './avatar-cache';
import { readEngineConfig } from './config';
import type { EngineConfig } from './config';
import { TelegramDriver } from './driver';
import type { EngineDeps } from './engine';
import { EngineStore } from './stats';
import { LoginApi } from './login-api';
import { LoginFlow } from './login-flow';
import { SessionLifecycle } from './lifecycle';
import { PushNotifier } from './push-notifier';
import { PushSubscriptions } from './push-subscriptions';
import { UpdatesSocketHub } from './socket-hub';

/**
The collaborators the engine resolves, one branded token per service.
*/
export const Tokens = {
  state: Symbol('DurableObjectState') as Token<DurableObjectState>,
  env: Symbol('CloudflareEnv') as Token<CloudflareEnv>,
  now: Symbol('clock') as Token<() => number>,
  config: Symbol('EngineConfig') as Token<EngineConfig>,
  store: Symbol('EngineStore') as Token<EngineStore>,
  avatars: Symbol('AvatarCache') as Token<AvatarCache>,
  driver: Symbol('TelegramDriver') as Token<TelegramDriver>,
  hub: Symbol('UpdatesSocketHub') as Token<UpdatesSocketHub>,
  login: Symbol('LoginFlow') as Token<LoginFlow>,
  loginApi: Symbol('LoginApi') as Token<LoginApi>,
  lifecycle: Symbol('SessionLifecycle') as Token<SessionLifecycle>,
  pushSubscriptions: Symbol('PushSubscriptions') as Token<PushSubscriptions>,
  notifier: Symbol('PushNotifier') as Token<PushNotifier>,
} as const;

/**
The three callbacks that reach back into the engine's own state. They are
supplied by the engine, not stored in a module global: each Durable Object
gets its own container, and two engines in one test process must not share a
callback.
*/
export interface EngineCallbacks {
  onLoginSettled(me: MeDto): void;
  onLoginFailed(error: string): void;
  stateSnapshot(): Promise<EngineStateDto>;
}

/**
Binds the engine's collaborators.

`deps` overrides the three services a test may replace; every other binding
is derived from the state, the environment and the one clock all of them
share.
*/
export function createEngineContainer(
  state: DurableObjectState,
  env: CloudflareEnv,
  deps: EngineDeps,
  now: () => number,
  callbacks: EngineCallbacks,
): Container {
  const container: Container = new Container()
    .bindValue(Tokens.state, state)
    .bindValue(Tokens.env, env)
    .bindValue(Tokens.now, now)
    .bind(Tokens.config, () => readEngineConfig(container.get(Tokens.env)))
    .bind(Tokens.store, () => deps.store ?? new EngineStore(container.get(Tokens.state).storage.sql, container.get(Tokens.now)))
    .bind(Tokens.avatars, () => deps.avatars ?? new AvatarCache(container.get(Tokens.state).storage.sql, container.get(Tokens.now)))
    .bind(
      Tokens.driver,
      () =>
        deps.driver ??
        new TelegramDriver(container.get(Tokens.env), container.get(Tokens.state).storage, undefined, container.get(Tokens.config)),
    )
    .bind(
      Tokens.hub,
      () =>
        new UpdatesSocketHub(container.get(Tokens.state), {
          ensureLive: () => container.get(Tokens.lifecycle).ensureLive(),
          stopLive: () => container.get(Tokens.lifecycle).stopLive(),
          sendCallSignaling: (callId, data) => container.get(Tokens.driver).sendCallSignaling(callId, data),
        }),
    )
    .bind(
      Tokens.login,
      () =>
        new LoginFlow(
          container.get(Tokens.driver),
          (me) => callbacks.onLoginSettled(me),
          (error) => callbacks.onLoginFailed(error),
          (work) => container.get(Tokens.lifecycle).background(work),
        ),
    )
    .bind(
      Tokens.lifecycle,
      () =>
        new SessionLifecycle({
          driver: container.get(Tokens.driver),
          hub: container.get(Tokens.hub),
          login: container.get(Tokens.login),
          state: container.get(Tokens.state),
          store: container.get(Tokens.store),
          config: container.get(Tokens.config),
          now: container.get(Tokens.now),
        }),
    )
    .bind(
      Tokens.pushSubscriptions,
      () => deps.pushSubscriptions ?? new PushSubscriptions(container.get(Tokens.state).storage.sql, container.get(Tokens.now)),
    )
    .bind(
      Tokens.notifier,
      () =>
        deps.notifier ??
        new PushNotifier({
          env: container.get(Tokens.env),
          subscriptions: container.get(Tokens.pushSubscriptions),
          now: container.get(Tokens.now),
          schedule: (work) => container.get(Tokens.lifecycle).background(work()),
        }),
    )
    .bind(Tokens.loginApi, () => new LoginApi(container.get(Tokens.login), () => callbacks.stateSnapshot()));

  return container;
}
