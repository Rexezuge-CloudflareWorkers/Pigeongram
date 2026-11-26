import react from '@vitejs/plugin-react';
import { defineRepoVitestConfig } from '@rexezuge/tooling/vitest-repo';

/**
The unit suite, on the kit's single-file `projects` factory: the backend half
runs under `node`, the SPA half under jsdom. `test/web/**` is the SPA half's
shape (the factory's `WEB_INCLUDE`), and everything else in `test/` is
backend.

Coverage is one floor for the whole suite. The factory's default `include`
already names this workspace's layout (the apps' `src` trees and every
package's `src`); the SPA's React bootstrap is the one exclusion, because
nothing in it behaves and so nothing in it can be asserted.
*/
export default defineRepoVitestConfig({
  scope: '@pigeongram',
  root: new URL('.', import.meta.url).href,

  web: {
    plugins: [react()],
    setupFiles: ['./test/web/setup.ts'],
    serverDepsInline: ['node:zlib'],
  },

  coverageExclude: ['apps/web/src/main.tsx'],

  // Per-module coverage floors (Phase 4.1): the single global 80% gate is
  // replaced by per-area floors that start at or below current coverage and
  // ratchet upward. A global safety net sits underneath so no area can silently
  // regress below it.
  thresholds: {
    // Global safety net, ratcheted to the suite's current coverage.
    lines: 95,
    statements: 92,
    branches: 87,
    functions: 92,

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

    // Calls subsystem. Every call module lives at the session root and is
    // covered by `call*.ts`; there is no `calls/` directory to gate.
    'packages/backend-services/src/session/call*.ts': {
      statements: 80,
      branches: 75,
      functions: 85,
      lines: 80,
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

    // The glob groups above are aggregates: a module at 0% can hide inside a
    // passing group. These per-file floors name the modules that were weakest
    // when the aggregate gates were introduced, so a regression in one of them
    // fails the build instead of being averaged away. Phase 5 tests lift them.
    perFile: {
      'apps/web/src/recorder-loader.ts': { lines: 100, functions: 100 },
      'apps/web/src/api/stickers.ts': { lines: 100, branches: 100, functions: 100 },
      'apps/web/src/calls/api.ts': { functions: 100 },
      'apps/web/src/useMessageEdit.ts': { lines: 100, branches: 90, functions: 90 },
      'apps/web/src/useDeletionReport.ts': { lines: 100, functions: 100 },
      'apps/web/src/components/CommandMenu.tsx': { lines: 60, functions: 60 },
      'packages/backend-services/src/session/stats.ts': { lines: 95, branches: 70, functions: 100 },
      'packages/backend-services/src/session/rpc-dialogs.ts': { lines: 85, branches: 85, functions: 65 },
      'packages/backend-services/src/session/container.ts': { lines: 90, branches: 100, functions: 90 },
    },
  },
});
