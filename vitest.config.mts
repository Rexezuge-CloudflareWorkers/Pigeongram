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

  // The flat floor W2 lands on: every metric at 80%, measured over the whole
  // suite. A regression in any one metric fails `test:coverage`, so new code
  // arrives with its tests rather than borrowing the suite's headroom.
  thresholds: {
    lines: 80,
    statements: 80,
    branches: 80,
    functions: 80,
  },
});
