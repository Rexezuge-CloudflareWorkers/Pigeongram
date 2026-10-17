import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineRepoLintConfig } from '@rexezuge/tooling/eslint';

/**
 * The family's converged lint config (see `@rexezuge/tooling`), plus this
 * repository's two departures from the canonical layout:
 *
 * - `pages/` is the SPA here (`apps/web` is the family's usual directory), so
 *   the browser globals and the react-hooks rules are attached to it
 *   explicitly — the kit leaves both to the consumer.
 * - `pages/dist` and `worker/dist` are build output the factory's ignore list
 *   does not name, and `.wrangler/` holds local dev state.
 */
export default [
  ...defineRepoLintConfig({
    scope: '@telegram-web-client',
    tsconfigRootDir: import.meta.dirname,
    extraIgnores: ['pages/dist/**', 'worker/dist/**', '.wrangler/**'],
  }),

  {
    files: ['pages/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
    languageOptions: {
      // The SPA's tests run under jsdom, so the lint environment matches the
      // environment the code executes in.
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
];
