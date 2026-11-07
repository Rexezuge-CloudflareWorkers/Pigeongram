/**
 * The dependency-injection seam.
 *
 * The kit's container is deliberately minimal — factory and singleton scopes,
 * branded tokens, nothing else. The request-scope helpers are the family's
 * one-scope-per-request pattern: middleware installs the scope, handlers
 * resolve through it, and singleton memoization holds for the request.
 *
 * This repository's composition root is the Durable Object's constructor, so
 * the container is not used yet; the seam exists so a service that grows a
 * collaborator graph can adopt the family shape without a second copy of it.
 */
export { Container } from '@rexezuge/runtime/di/Container';
export type { Factory, Token } from '@rexezuge/runtime/di/Container';
export {
  SCOPE_MISSING_MESSAGE,
  asScopedContext,
  getRequestScope,
  setRequestScope,
  tryGetRequestScope,
} from '@rexezuge/runtime/di/RequestScope';
export type { ScopedContext } from '@rexezuge/runtime/di/RequestScope';
