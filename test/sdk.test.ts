import { ServiceError } from '@rexezuge/errors';
import { HttpStatusError } from '@rexezuge/web/api';
import { describe, expect, it } from 'vitest';

/**
 * The `@rexezuge/*` packages are linked from the sibling SDK checkout, not
 * installed from the registry. Node resolves a `link:` dependency to its real
 * path, so every workspace package that imports `@rexezuge/errors` must see the
 * same module instance — otherwise `instanceof ServiceError` silently answers
 * `false` for an error thrown by the API client. Vite's `resolve.dedupe` covers
 * the SPA bundle; this test covers the Node side, where the shared suite runs.
 */
describe('linked @rexezuge packages', () => {
  it('share a single ServiceError class across packages', () => {
    const error = new HttpStatusError(418, 'Teapot', 'teapot');

    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.status).toBe(418);
    expect(error.type).toBe('teapot');
  });
});
