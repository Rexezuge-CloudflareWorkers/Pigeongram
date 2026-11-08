import { AbstractEntrypointWorker } from '@pigeongram/backend-runtime/base';
import { EngineError } from '@pigeongram/backend-services/session/errors';
import { errorResponse } from '@pigeongram/backend-services/session/http';
import { log } from '@pigeongram/backend-services/session/log';
import { Hono } from 'hono';
import { allRoutes } from '../endpoints/routeTable';
import type { RouteDefinition } from '../endpoints/routeTable';
import { correlationMiddleware, MiddlewareHandlers, securityHeadersMiddleware, USER_API_LIMIT } from '../middleware';
import type { ApiEnv } from '../types';

/**
 * The API worker.
 *
 * The class owns composition only: middleware order and route registration.
 * Everything the routes do lives beside them, and the platform's error and
 * 404 boundaries live here so every response — including the ones no handler
 * wrote — leaves in the family's canonical `{Exception:{Type,Message}}`
 * envelope.
 */
export class ApiWorker extends AbstractEntrypointWorker {
  private readonly app: Hono<ApiEnv>;

  constructor() {
    super();

    const app = new Hono<ApiEnv>();

    // First, so every response carries them — the redirect and the 404 are as
    // observable as a handler's JSON.
    app.use('*', correlationMiddleware);
    app.use('*', securityHeadersMiddleware);

    app.onError((error, c) => {
      // `errorResponse` logs the failure and masks an unknown 5xx message; the
      // static event name keeps the log queryable without leaking the error.
      log.error('worker.unhandled', { error, correlationId: c.get('correlationId') });
      return errorResponse(error, c.get('correlationId'));
    });

    app.notFound((c) => errorResponse(new EngineError('Not found', 404), c.get('correlationId')));

    // The Access configuration guard runs before authentication so a
    // deployment with no verifier fails closed rather than running
    // unauthenticated. The origin and rate-limit guards follow authentication
    // so an unauthenticated caller cannot spend the account's budget.
    app.use('/user/*', MiddlewareHandlers.accessConfiguration());
    app.use('/user/*', MiddlewareHandlers.authenticate());
    app.use('/user/*', MiddlewareHandlers.origin());
    app.use('/user/*', USER_API_LIMIT);

    for (const route of allRoutes) {
      registerRoute(app, route);
    }

    this.app = app;
  }

  protected async onRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return this.app.fetch(request, env, ctx);
  }

  protected async onScheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // This worker declares no cron triggers: the session engine's alarm is its
    // cadence. The hook exists because the base requires it, and the platform
    // never invokes it without a `triggers.crons` entry.
  }
}

/**
 * Register one table entry.
 *
 * A switch rather than `app[route.method](…)`: the three Hono methods have
 * different overload sets, and a union of them is not callable without a cast.
 */
function registerRoute(app: Hono<ApiEnv>, route: RouteDefinition): void {
  switch (route.method) {
    case 'get': {
      app.get(route.path, route.handler);
      return;
    }
    case 'post': {
      app.post(route.path, route.handler);
      return;
    }
    case 'all': {
      app.all(route.path, route.handler);
      return;
    }
  }
}
