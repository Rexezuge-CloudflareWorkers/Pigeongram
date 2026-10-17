import react from '@vitejs/plugin-react';
import { defineRepoVitestConfig } from '@rexezuge/tooling/vitest-repo';

/**
 * The unit suite, on the kit's single-file `projects` factory: the worker half
 * runs under `node`, the SPA half under jsdom. `test/web/**` is the SPA half's
 * shape (the factory's `WEB_INCLUDE`), and everything else in `test/` is
 * backend.
 */
export default defineRepoVitestConfig({
  scope: '@telegram-web-client',
  root: new URL('.', import.meta.url).href,

  // This repo has no `packages/` tree and no `cloudflare:*` specifiers, so the
  // factory's default tables would be aliases pointing at paths that do not
  // exist. Empty lists keep the resolver table to this repository's surface.
  packages: [],
  mocks: [],

  web: {
    plugins: [react()],
  },

  // The factory's default coverage `include` names `apps/*` and `packages/*`;
  // this repo's source lives in `worker/` and `pages/`.
  coverageInclude: ['worker/src/**/*.ts', 'pages/src/**/*.{ts,tsx}'],
});
