import { ServiceError } from '@rexezuge/errors';
import { HttpStatusError } from '@rexezuge/web/api';
import { describe, expect, it } from 'vitest';

/**
 * `@rexezuge/web` and `@rexezuge/errors` are published packages, and the API
 * client throws the latter's `ServiceError` subclasses. pnpm must resolve one
 * copy of `@rexezuge/errors` for the workspace and for the client's own
 * dependency: two copies would make `instanceof ServiceError` silently answer
 * `false` for an error the client threw.
 */
describe('@rexezuge packages', () => {
  it('share a single ServiceError class across packages', () => {
    const error = new HttpStatusError(418, 'Teapot', 'teapot');

    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.status).toBe(418);
    expect(error.type).toBe('teapot');
  });
});
