import type { Context, Handler } from 'hono';

/**
 * The worker's Hono surface.
 *
 * `Bindings` is the deployment's `Env`; `Variables` carries what the
 * correlation middleware resolved for this request. Naming it once keeps the
 * route table, the middleware and the worker class from drifting into three
 * slightly different generics.
 */
export interface ApiEnv {
  Bindings: Env;
  Variables: {
    correlationId: string;
  };
}

export type ApiContext = Context<ApiEnv>;
export type ApiHandler = Handler<ApiEnv>;
