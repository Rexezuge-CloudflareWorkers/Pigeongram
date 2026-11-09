import react from '@vitejs/plugin-react';
import { defineRepoVitestConfig } from '@rexezuge/tooling/vitest-repo';

/**
 * The unit suite, on the kit's single-file `projects` factory: the backend half
 * runs under `node`, the SPA half under jsdom. `test/web/**` is the SPA half's
 * shape (the factory's `WEB_INCLUDE`), and everything else in `test/` is
 * backend.
 *
 * Coverage is one floor for the whole suite. The factory's default `include`
 * already names this workspace's layout (the apps' `src` trees and every
 * package's `src`); the SPA's React bootstrap is the one exclusion, because
 * nothing in it behaves and so nothing in it can be asserted.
 */
export default defineRepoVitestConfig({
  scope: '@pigeongram',
  root: new URL('.', import.meta.url).href,

  web: {
    plugins: [react()],
  },

  coverageExclude: ['apps/web/src/main.tsx'],

  // Per-module coverage floors (Phase 4.1): the single global 80% gate is
  // replaced by per-area floors that start at or below current coverage and
  // ratchet upward. A global safety net sits underneath so no area can silently
  // regress below it.
  thresholds: {
    // Global safety net, ratcheted to the suite's current coverage.
    lines: 94,
    statements: 92,
    branches: 85,
    functions: 91,

    // Pure validation / DTO layer.
    'packages/shared/src/**': {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },

    // Security-critical session engine paths.
    'packages/backend-services/src/session/{engine,lifecycle,media,upload,media-routes,socket-hub}.ts': {
      statements: 85,
      branches: 75,
      functions: 85,
      lines: 85,
    },

    // Calls subsystem.
    'packages/backend-services/src/session/call*.ts': {
      statements: 80,
      branches: 75,
      functions: 85,
      lines: 80,
    },
    'packages/backend-services/src/session/calls/**': {
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90,
    },

    // Driver (gateway-level tests).
    'packages/backend-services/src/session/driver.ts': {
      statements: 95,
      branches: 88,
      functions: 95,
      lines: 95,
    },

    // Pure reducers in the SPA.
    'apps/web/src/state/**': {
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95,
    },

    // Hooks.
    'apps/web/src/use*.ts': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },

    // Components.
    'apps/web/src/components/**': {
      statements: 75,
      branches: 70,
      functions: 75,
      lines: 75,
    },
  },
});
