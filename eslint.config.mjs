import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineRepoLintConfig } from '@rexezuge/tooling/eslint';

/**
 * The family's converged lint config (see `@rexezuge/tooling`), plus this
 * repository's departures from the canonical layout:
 *
 * - the browser globals and the react-hooks rules are attached to the SPA
 *   explicitly — the kit leaves both to the consumer.
 * - built `dist` output under each app is not named by the factory's ignore
 *   list, and `.wrangler/` holds local dev state.
 */
export default [
  ...defineRepoLintConfig({
    scope: '@pigeongram',
    tsconfigRootDir: import.meta.dirname,
    extraIgnores: ['apps/*/dist/**', '.wrangler/**'],
  }),

  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
    languageOptions: {
      // The SPA's tests run under jsdom, so the lint environment matches the
      // environment the code executes in.
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
];
