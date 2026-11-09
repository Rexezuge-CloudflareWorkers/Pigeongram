import { engineHandler } from './engine';
import { healthHandler } from './health';
import { loginHandler } from './login';
import { uploadGroupHandler, uploadHandler } from './upload';
import type { ApiHandler } from '../types';

type RouteMethod = 'get' | 'post' | 'all';

interface RouteDefinition {
  readonly method: RouteMethod;
  readonly path: string;
  readonly handler: ApiHandler;
}

/**
 * Declarative table of every route the worker serves.
 *
 * Keeping the list as data rather than a block of `app.get(…)` calls lets the
 * worker register it in one loop and lets a test enumerate the surface. The
 * two groups mirror the auth boundary: `/api/*` is public and carries no
 * account data, while everything under `/user/*` sits behind Cloudflare
 * Access. Order matters only inside `userRoutes`: the specific handlers run
 * before the `/user/*` engine proxy that would otherwise swallow them.
 */
const publicRoutes: readonly RouteDefinition[] = [{ method: 'get', path: '/api/health', handler: healthHandler }];

const userRoutes: readonly RouteDefinition[] = [
  { method: 'get', path: '/user/login', handler: loginHandler },
  { method: 'post', path: '/user/upload', handler: uploadHandler },
  { method: 'post', path: '/user/upload-group', handler: uploadGroupHandler },
  { method: 'all', path: '/user/*', handler: engineHandler },
];

const allRoutes: readonly RouteDefinition[] = [...publicRoutes, ...userRoutes];

export { allRoutes };
export type { RouteDefinition };
