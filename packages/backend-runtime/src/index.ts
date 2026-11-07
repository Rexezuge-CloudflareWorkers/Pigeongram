/**
 * `@pigeongram/backend-runtime` — the platform seam.
 *
 * The repository consumes the kit's runtime through this package rather than
 * importing `@rexezuge/runtime` at each call site. That gives the platform
 * boundary one place to name, and one place to adapt when a kit change needs a
 * local shape. The subpath exports (`./base`, `./config`, `./constants`,
 * `./di`) are the supported entry points; this barrel exists for a caller that
 * wants the whole seam.
 */
export * from './base';
export * from './config';
export * from './constants';
export * from './di';
