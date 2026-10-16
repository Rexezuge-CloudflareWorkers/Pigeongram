# Telegram-Web-Client — Scaffold Implementation Plan

> **Status:** planning artifact, written 2026-10-16 by an OpenCode session (model `opencode/deepseek-v4.1-flash-free`) on branch
> `docs/scaffold-plan` (base commit `29a3b84 MIT LICENSE`). It is written so that a **fresh agent with no memory of the planning
> conversation** can execute the whole scaffold end-to-end. Read it top to bottom before touching anything.
>
> **What this plan is NOT:** it does not build the Telegram product. It bootstraps the repository — workspace layout, tooling
> gates, and the Cloudflare Workers/Pages CI+CD suite ported from `AWS-AccessBridge` — with a minimal-but-real worker skeleton and
> Pages skeleton so every workflow starts green on day one. Product work (MTProto session engine, UI fork) is described in
> ["Out of Scope / Next Phases"](#12-out-of-scope--next-phases) for orientation only.

---

## 1. Mission & Context

**Telegram-Web-Client** will be an always-online Telegram web client hosted on Cloudflare:

- **Worker** (top-level `worker/`): the backend — a Hono API and, later, a Durable Object ("AccountDO") that is the single home
  of one Telegram account's MTProto session. The DO wakes on an alarm every few minutes, connects to Telegram over WSS
  (`wss://{pluto|venus|aurora|vesta|flora}.web.telegram.org:443/apiws`), replays `getDifference`, persists to DO SQLite, disconnects,
  and re-arms its own alarm. A live socket is kept only while at least one browser tab is connected. One account, single user,
  Free-tier-first (the 10 ms CPU per-invocation Free limit is the main constraint to be measured in a later spike).
- **Pages** (top-level `pages/`): the frontend — later a fork of [`telegram-tt`](https://github.com/PBhadoo/telegram-tt) talking to
  the Worker over a small RPC bridge (`POST /rpc`, `WS /updates`, `GET /file/*`). At scaffold time this is just a minimal Vite +
  React SPA.

The repository is currently **empty except for `LICENSE`** (MIT, commit `29a3b84`). Its sibling repos under
`/home/engineer/workspace/1_CloudflareWorkers/` share a house CI/CD style (see §4), and the user has asked to bring the fullest
version of it — `AWS-AccessBridge`'s suite — here, **with `worker/` and `pages/` as separate top-level projects** and a **single
`continuous-deployment.yml` with two jobs** (`deploy-worker`, `deploy-pages`).

## 2. Repository State at Planning Time

| Item | Value |
| --- | --- |
| Local path | `/home/engineer/workspace/1_CloudflareWorkers/Telegram-Web-Client` |
| Origin | `https://1@github.com/Rexezuge-CloudflareWorkers/Telegram-Web-Client.git` (org: `Rexezuge-CloudflareWorkers`) |
| Branch | `main`, tracking `origin/main`, clean tree |
| Commits | `29a3b84 MIT LICENSE` (single commit) |
| Files | `LICENSE` only |
| Git identity | user `Rexezuge <79224316+Rexezuge@users.noreply.github.com>` (global config) |
| Toolchain (local machine) | Volta-managed Node/pnpm; sibling repos run commands via `source ~/.customrc` then `volta run pnpm …` |
| This plan | committed on branch `docs/scaffold-plan`; the implementer should base work off `main` and either merge this branch first or read `PLAN.md` from it |

## 3. Decisions Locked With the User (do not re-litigate)

1. **Target repo:** `Telegram-Web-Client` (not the umbrella folder, not a sibling).
2. **Worker/pages separation:** separate top-level directories `worker/` and `pages/`, joined by one pnpm workspace; **one
   `continuous-deployment.yml` with two independent jobs** (`deploy-worker`, `deploy-pages`) — the AWS-AccessBridge shape.
3. **CI job set:** "adapted full suite": `typecheck`, `lint`, `god-files`, `unit-tests` (with coverage artifact), `build-web`,
   plus the two shared tail jobs (`dependabot-auto-merge`, `dispatch-upstream-sync-deployment`). **Dropped:** `migrations`,
   `locales`, `integration-tests`, `floci-smoke`, `spa-shell` (all AWS-specific and meaningless here).
4. **`backup-d1.yml`: skipped entirely.** This project has no D1 (the DO's SQLite storage is the datastore; see §12 for the future
   DO-backup question). `scripts/backup/**` is likewise not ported.
5. **Everything else from AWS-AccessBridge's `.github/` comes over:** `continuous-integration.yml` (adapted), `continuous-deployment.yml`
   (adapted), `backup-main.yml`, `scheduled-version-update.yml`, `upstream-sync.yml`, `dependabot.yml`, `.github/actions/setup-env`,
   `.github/actions/retry-step`, `.github/.version`.
6. **Secrets Store initialisation (`init-secrets.ts`) is deferred.** The worker has no secrets at scaffold time; when Telegram
   credentials (`API_ID`/`API_HASH`) arrive they can be set with plain `wrangler secret put` first, and the Secrets Store machinery
   (AWS-AccessBridge's `scripts/deploy/init-secrets.ts` + `scripts/lib/wrangler-table.ts`) can be ported later if wanted.
7. **The worker here is API-only.** Unlike AWS-AccessBridge (whose worker serves an embedded SPA shell), **no `assets`, no
   `spa-shell` machinery, no open-next workarounds** belong in this repo's worker or deploy workflow. The UI lives on Pages.

## 4. Reference Sources on This Machine

The implementing agent should copy/adapt from these local paths (same machine, read-only references):

| Reference | Path |
| --- | --- |
| Full workflow suite (source of truth) | `/home/engineer/workspace/1_CloudflareWorkers/AWS-AccessBridge/.github/` |
| CI (372 lines) | `…/AWS-AccessBridge/.github/workflows/continuous-integration.yml` |
| CD (184 lines) | `…/AWS-AccessBridge/.github/workflows/continuous-deployment.yml` |
| Repo-mirror backup (copy verbatim) | `…/AWS-AccessBridge/.github/workflows/backup-main.yml` |
| Version bump (copy verbatim) | `…/AWS-AccessBridge/.github/workflows/scheduled-version-update.yml` |
| Fork sync (one-line edit) | `…/AWS-AccessBridge/.github/workflows/upstream-sync.yml` |
| Composite actions (copy verbatim) | `…/AWS-AccessBridge/.github/actions/{setup-env,retry-step}/action.yml` |
| Root tooling to mirror | `…/AWS-AccessBridge/package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `.prettierrc`, `.editorconfig`, `.npmrc`, `.gitignore`, `eslint.config.mjs`, `vitest.config.mts` |
| God-file gate (copy verbatim) | `…/AWS-AccessBridge/scripts/check-god-files.mjs` |
| Worker template reference | `…/AWS-AccessBridge/apps/api/wrangler.template.jsonc` |
| Pages template reference | `…/AWS-AccessBridge/apps/web/wrangler.template.jsonc` |
| Pages app reference (tsconfig/vite) | `…/AWS-AccessBridge/apps/web/{tsconfig.json,vite.config.ts}` |
| Lighter alternates (Pages-only style, still house conventions) | `…/Pages-Reverse-Proxy/`, `…/TOTP-Generator/`, `…/Secrets-Provider/` |

**A caveat about copying:** AWS-AccessBridge carries years of hard-won comments. Where this plan says "copy verbatim", copy the
comments too — they are documentation. Where this plan says "adapt", keep the reasoning comments that still apply and rewrite or
delete the ones that referenced jobs/steps you are removing.

## 5. Naming & Identifiers (use these exactly)

| Thing | Value |
| --- | --- |
| Root package | `@telegram-web-client/monorepo` |
| Worker package | `@telegram-web-client/worker` |
| Pages package | `@telegram-web-client/pages` |
| Test package | `@telegram-web-client/test` |
| Cloudflare Worker name | `telegram-web-client` |
| Cloudflare Pages project | `telegram-web-client-web` (repo var `CLOUDFLARE_PAGES_PROJECT_NAME` can override) |
| DO class / binding / migration tag | `SessionEngine` / `SESSION_ENGINE` / `v1` (SQLite-backed) |
| Generated Env interface | `CloudflareEnv` |
| Pages → Worker service binding | `API_WORKER` → service `telegram-web-client` |
| Worker local dev port / Vite dev port | `8787` (wrangler default) / `5173` (Vite default) |

If the user ever renames the Worker or Pages project, the four places to touch are: `worker/wrangler.template.jsonc` (`name`),
`pages/wrangler.template.jsonc` (`name` + `services[].service`), and the `telegram-web-client-web` defaults inside
`continuous-deployment.yml`.

## 6. Target Tree

```
Telegram-Web-Client/
├── .editorconfig                     # copied from AWS-AccessBridge
├── .gitignore                        # new (subset of AWS's, see §7.1)
├── .npmrc                            # copied (minimum-release-age=0)
├── .prettierrc                       # copied (140 col, single quotes)
├── AGENTS.md                         # new — repo index (house style)
├── CLAUDE.md -> AGENTS.md            # symlink (AWS-AccessBridge does the same)
├── LICENSE                           # exists, keep
├── PLAN.md                           # this file — delete once scaffold lands
├── README.md                         # new — what/why, commands, deploy, settings
├── eslint.config.mjs                 # copied from AWS-AccessBridge, ignores adjusted
├── package.json                      # new (root scripts + devDeps, §7.1)
├── pnpm-lock.yaml                    # generated by first `pnpm install`, commit it
├── pnpm-workspace.yaml               # new (worker, pages, test; allowBuilds)
├── tsconfig.json                     # copied from AWS-AccessBridge root
├── vitest.config.mts                 # new (single jsdom project over test/)
├── .github/
│   ├── .version                      # new — seed with `date +%s`
│   ├── dependabot.yml                # copied verbatim
│   ├── actions/
│   │   ├── retry-step/action.yml     # copied verbatim
│   │   └── setup-env/action.yml      # copied verbatim
│   └── workflows/
│       ├── continuous-integration.yml    # adapted (§7.6)
│       ├── continuous-deployment.yml     # adapted (§7.6)
│       ├── backup-main.yml               # copied verbatim
│       ├── scheduled-version-update.yml  # copied verbatim
│       └── upstream-sync.yml             # copied, one line edited
├── pages/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── wrangler.template.jsonc       # materialized to root at deploy
│   └── src/
│       ├── App.tsx
│       └── main.tsx
├── scripts/
│   ├── check-god-files.mjs           # copied verbatim
│   ├── tsconfig.json                 # adapted from AWS scripts/tsconfig.json
│   └── deploy/
│       └── materialize-wrangler-config.ts   # new, slim (§7.2)
├── test/
│   ├── package.json
│   ├── tsconfig.json
│   ├── pages.test.tsx
│   └── worker.test.ts
└── worker/
    ├── package.json
    ├── tsconfig.json
    ├── wrangler.template.jsonc       # materialized to root at deploy
    └── src/
        ├── index.ts
        └── session-engine.ts
```

Runtime artifacts that must **never** be committed (gitignored): `wrangler.jsonc` (materialized at deploy/dev time),
`worker-configuration.d.ts` (generated by `pnpm run typegen`), `node_modules/`, `dist/`, `coverage/`, `.wrangler/`, `.dev.vars`.

## 7. File-by-File Specification

### 7.1 Root tooling

**`package.json`** — mirror AWS-AccessBridge's shape, minus everything AWS-specific:

```json
{
  "name": "@telegram-web-client/monorepo",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "postinstall": "pnpm run typegen",
    "build": "pnpm -r build",
    "checks": "pnpm run checks:fast && pnpm run test:coverage",
    "checks:fast": "pnpm run typecheck && pnpm run lint && pnpm run check:god-files",
    "prettier": "prettier --write .",
    "typecheck": "pnpm -r typecheck && pnpm run typecheck:scripts",
    "typecheck:scripts": "tsc -p scripts/tsconfig.json --noEmit",
    "check:god-files": "node scripts/check-god-files.mjs",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "NODE_OPTIONS=--max-old-space-size=6144 eslint --fix --quiet .",
    "typegen": "wrangler types --config ./worker/wrangler.template.jsonc --env-interface CloudflareEnv"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.3",
    "@types/node": "26.6.4",
    "@vitest/coverage-v8": "4.1.11",
    "eslint": "10.11.0",
    "eslint-config-prettier": "10.1.8",
    "eslint-plugin-prettier": "5.5.6",
    "eslint-plugin-react-hooks": "7.1.1",
    "eslint-plugin-regexp": "3.3.1",
    "eslint-plugin-sonarjs": "4.2.2",
    "eslint-plugin-unicorn": "76.0.0",
    "globals": "17.13.0",
    "jsdom": "^30.1.1",
    "jsonc-parser": "3.3.1",
    "prettier": "3.9.9",
    "tsx": "4.23.15",
    "typescript": "6.0.3",
    "typescript-eslint": "8.71.0",
    "vite": "8.3.2",
    "vitest": "4.1.11",
    "wrangler": "4.147.0"
  },
  "packageManager": "pnpm@11.2.2"
}
```

- Versions are lifted from `AWS-AccessBridge/package.json` (proven together). Deviations from AWS: dropped
  `@cloudflare/vitest-pool-workers` (needs the Workers test pool; add when real worker tests arrive), dropped
  `@testing-library/{jest-dom,user-event}` (scaffold tests use plain assertions), dropped floci/AWS-only entries.
- `postinstall` **must** run `typegen` so a fresh clone always has `worker-configuration.d.ts` before `tsc` runs. That file is
  gitignored; CI's `setup-env` runs `pnpm install`, so typegen happens there too.
- `lint` intentionally carries `--fix` and the `NODE_OPTIONS` memory bump — copy the house convention; CI runs it as-is (fixes
  are not committed by CI, so locally linted-clean code is the contract).

**`pnpm-workspace.yaml`**:

```yaml
packages:
  - 'worker'
  - 'pages'
  - 'test'
# pnpm 11 refuses to run dependency build scripts unless allowlisted. esbuild and
# workerd are what Vite/Vitest/Wrangler need; without them installs succeed but
# binaries are missing at runtime. (AWS-AccessBridge also allows `sharp` — only
# needed there because of image tooling; add here if it is ever used.)
allowBuilds:
  esbuild: true
  workerd: true
```

**`tsconfig.json`** — copy AWS-AccessBridge's root tsconfig **verbatim** (ES2022, `lib: ["ES2022","DOM"]`, `module`/`moduleResolution`
`ES2022`/`Bundler`, `strict`, `skipLibCheck`, `noEmit`, `types: ["node"]`).

**`vitest.config.mts`** — new, deliberately simple (AWS's two-project split is for a much bigger suite):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    // Naming `exclude` REPLACES Vitest's defaults; node_modules must be named
    // explicitly or the suite collects dependencies' own test files.
    exclude: ['**/node_modules/**'],
    coverage: { provider: 'v8', reporter: ['text', 'html', 'lcov'] },
  },
});
```

**`.gitignore`** — new; a focused subset of AWS's (which carries ~15 years of legacy entries):

```
wrangler.jsonc
worker-configuration.d.ts

node_modules/
dist/
coverage/
.wrangler/
.dev.vars
.vscode/
*.log
```

**`.prettierrc`** — copy verbatim: `{ "printWidth": 140, "singleQuote": true, "semi": true, "useTabs": false }`.

**`.editorconfig`** — copy verbatim from AWS-AccessBridge (187 bytes).

**`.npmrc`** — copy verbatim (`minimum-release-age=0`).

**`eslint.config.mjs`** — copy AWS-AccessBridge's verbatim, then adjust only the `ignores` array at the top:
remove `app/dist/**`, `apps/web/dist/**`, `src/generated/**`, `apps/api/src/generated/**`; add `pages/dist/**`, `worker/dist/**`;
keep `eslint.config.mjs`, `worker-configuration.d.ts`, `coverage/**`, `node_modules/**`. The rule stack (type-aware
`recommendedTypeChecked`, unicorn, sonarjs, react-hooks, regexp, prettier bridge) is kept — it is the house standard and the
root `devDependencies` above carry everything it imports.

**`AGENTS.md`** (new) — house-style repo index, modeled on `Pages-Reverse-Proxy/AGENTS.md` and `AWS-AccessBridge/AGENTS.md`:
overview (one paragraph from §1), "Commands" table (`source ~/.customrc` + `volta run pnpm …` variants for install/typecheck/lint/
test/build/typegen), an "Architecture" section describing `worker/` vs `pages/` vs `test/` and the materialized `wrangler.jsonc`
trick, a "Workflows" list (what each workflow does, what triggers it, required secrets/vars), and a "Keeping AGENTS.md Current"
section. Add `CLAUDE.md` as a symlink to `AGENTS.md` (`ln -s AGENTS.md CLAUDE.md`).

**`README.md`** (new) — what the project is (and where it's going: worker = Telegram session engine, pages = web UI), local dev
commands (see §9), deploy story (CI → CD → worker + Pages project auto-create), required GitHub secrets/vars (see §8), and a short
"first deploy" runbook.

### 7.2 `scripts/`

- **`scripts/check-god-files.mjs`** — copy **verbatim** from AWS-AccessBridge. It walks the repo from its parent directory
  (`new URL('..', import.meta.url)` — correct from `scripts/`), soft-warns at 300 LOC, fails at 400, and excludes
  `node_modules`, `dist`, `.wrangler`, `coverage`, `.git`, plus test files. No changes needed.
- **`scripts/tsconfig.json`** — adapt AWS's (`extends: ../tsconfig.json`, `lib: ["ESNext","DOM"]`, `noUncheckedIndexedAccess: true`,
  `types: ["node"]`, `include: ["**/*.ts"]`); drop the `functions/` exclude (no root `functions/` here).
- **`scripts/deploy/materialize-wrangler-config.ts`** — **new, slim replacement** for AWS-AccessBridge's
  `prepare-wrangler-config.ts` machinery (that one also provisions D1/KV via the Cloudflare API — not needed here). Contract:
  1. Read `worker/wrangler.template.jsonc` with `jsonc-parser`'s `parse` (collect `ParseError`s; on any, print them and exit 1 —
     comments are allowed, the parse is tolerant, but real syntax errors must fail loudly).
  2. If env `WRANGLER_JSONC` is set (non-empty), use it as the base instead of the template file (mirrors AWS's repo-var escape
     hatch).
  3. If env `WRANGLER_PATCH_JSON` is set, parse it as JSON and apply a **shallow top-level merge** onto the base (arrays replace
     wholesale — same practical semantics AWS-AccessBridge relies on).
  4. If env `WRANGLER_VARS_PATCH_JSON` is set, parse it and merge it into the config's `vars` object (shallow).
  5. Sanity-check the result has `name`, `main`, `durable_objects.bindings`, `migrations`; fail with a named error listing what
     is missing otherwise.
  6. Write `wrangler.jsonc` at the repo root as pretty-printed JSON + trailing newline (JSON is valid JSONC; comments in the
     output are not needed) and print a one-line summary.
  - Environment variable names match AWS-AccessBridge (`WRANGLER_JSONC`, `WRANGLER_PATCH_JSON`, `WRANGLER_VARS_PATCH_JSON`) so repo
    variables configured later behave as expected.
  - Run via `pnpm exec tsx scripts/deploy/materialize-wrangler-config.ts` from the repo root.

### 7.3 `worker/`

**`worker/package.json`**:

```json
{
  "name": "@telegram-web-client/worker",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.13.12"
  },
  "devDependencies": {
    "@types/node": "^26.6.4",
    "typescript": "^6.0.3"
  }
}
```

**`worker/tsconfig.json`**:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["../worker-configuration.d.ts", "src/**/*.ts"]
}
```

(The generated `worker-configuration.d.ts` supplies runtime globals — `DurableObjectState`, `DurableObjectNamespace`, etc. — and
the `CloudflareEnv` interface.)

**`worker/src/session-engine.ts`** — a deliberately plain class, **not** extending `DurableObject` from `cloudflare:workers`:
that import cannot resolve under Vitest's jsdom/node runtime without the Workers pool, and a DO class does not need to extend it.
It will be rewritten when the real session engine lands; the names (`SessionEngine`, `SESSION_ENGINE`) are what matter now.

```ts
/**
 * Stub home of the future MTProto session engine. One instance per Telegram
 * account (idFromName(accountId)). In phase 1 this holds the auth key, replays
 * getDifference on alarm, and persists to DO SQLite; today it only proves the
 * binding and migration deploy correctly.
 */
export class SessionEngine {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CloudflareEnv,
  ) {}

  async fetch(_request: Request): Promise<Response> {
    return Response.json({ ready: false, service: 'telegram-web-client' });
  }

  async alarm(): Promise<void> {
    // Phase 1: wake cycle (connect → getDifference → persist → disconnect → re-arm).
  }
}
```

**`worker/src/index.ts`** — Hono entrypoint exporting the DO class by name (wrangler discovers the export):

```ts
import { Hono } from 'hono';

export { SessionEngine } from './session-engine';

const app = new Hono<{ Bindings: CloudflareEnv }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'telegram-web-client' }));

export default app;
```

**`worker/wrangler.template.jsonc`** — note `main` and every path is **root-relative**, because this file is materialized to
`./wrangler.jsonc` at the repo root (see §7.6 CD). No `assets`, no `services`, no D1/KV. Use the same `compatibility_date` as
`AWS-AccessBridge/apps/web/wrangler.template.jsonc` (`2025-12-31`) unless deliberately bumping.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "telegram-web-client",
  "main": "worker/src/index.ts",
  "compatibility_date": "2025-12-31",
  "placement": { "mode": "off" },
  "durable_objects": {
    "bindings": [{ "name": "SESSION_ENGINE", "class_name": "SessionEngine" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SessionEngine"] }],
  "vars": {
    "ENVIRONMENT": "production",
  },
}
```

### 7.4 `pages/`

**`pages/package.json`**:

```json
{
  "name": "@telegram-web-client/pages",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/App.tsx" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@types/node": "^26.4.4",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.7",
    "@vitejs/plugin-react": "^6.1.0",
    "typescript": "^6.0.3",
    "vite": "^8.3.2"
  }
}
```

(Run `pnpm install` and let pnpm resolve minor versions; the caret ranges mirror `AWS-AccessBridge/apps/web/package.json`.)

**`pages/tsconfig.json`** — model on `AWS-AccessBridge/apps/web/tsconfig.json` (ES2021, DOM libs, `jsx: react-jsx`, bundler
resolution, `types: ["vite/client"]`) but with `include: ["src/**/*.ts", "src/**/*.tsx"]` (no worker-configuration include — the
SPA does not touch worker bindings).

**`pages/vite.config.ts`** — minimal:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
```

(No tailwind, no favicon-inline plugin, no SPA-shell embedding — those belong to AWS-AccessBridge's worker-served UI, not here.)

**`pages/index.html`** — minimal Vite entry: title `Telegram Web Client`, `<div id="root">`, `<script type="module" src="/src/main.tsx">`.

**`pages/src/main.tsx`** — `createRoot(document.getElementById('root')!).render(<App />)`.

**`pages/src/App.tsx`** — minimal component: an `<h1>Telegram Web Client</h1>` and a short line stating the scaffold stage.

**`pages/wrangler.template.jsonc`** — the materialized-at-root quirk applies twice here: `pages_build_output_dir` is root-relative
(`pages/dist/`), and the service binding prepares the future RPC bridge (no Pages Functions exist yet, so the binding is inert until
phase 1):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "telegram-web-client-web",
  "compatibility_date": "2025-12-31",
  "pages_build_output_dir": "pages/dist/",
  "services": [{ "binding": "API_WORKER", "service": "telegram-web-client" }],
}
```

> **Why the paths look wrong at first glance:** `wrangler pages deploy` resolves `pages_build_output_dir` (and any future
> `functions/` directory) relative to the **materialized root config**, which is why CD copies this template to `./wrangler.jsonc`
> and why the value is `pages/dist/`, not `dist/`. AWS-AccessBridge has the identical quirk (`apps/web/dist/`). If Pages Functions
> are ever added, they must live at repo-root `functions/` — not `pages/functions/` — for the same reason.

### 7.5 `test/`

The test project is a **workspace package** on purpose: an unhooked out-of-workspace `test/` cannot resolve workspace
dependencies under pnpm's strict layout (this is a documented lesson in `AWS-AccessBridge/pnpm-workspace.yaml`). Keep it in the
workspace and, if a bare import fails to resolve during implementation, add that package to `test/package.json` — never loosen the
workspace.

**`test/package.json`**:

```json
{
  "name": "@telegram-web-client/test",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@telegram-web-client/pages": "workspace:*",
    "@telegram-web-client/worker": "workspace:*",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.3",
    "@types/node": "26.6.4",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.7",
    "jsdom": "^30.1.1",
    "typescript": "6.0.3",
    "vitest": "4.1.11"
  }
}
```

**`test/tsconfig.json`**:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["../worker-configuration.d.ts", "**/*.ts", "**/*.tsx"]
}
```

(`worker-configuration.d.ts` is included because the test imports the worker package, whose source references generated globals
like `DurableObjectState`.)

**`test/worker.test.ts`** — real, trivial assertion of the worker surface:

```ts
import { describe, expect, it } from 'vitest';
import { SessionEngine } from '@telegram-web-client/worker';

describe('SessionEngine (scaffold stub)', () => {
  it('answers on fetch with the not-ready payload', async () => {
    const engine = new SessionEngine({} as DurableObjectState, {} as CloudflareEnv);
    const response = await engine.fetch(new Request('https://session-engine.internal/'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ready: false, service: 'telegram-web-client' });
  });
});
```

**`test/pages.test.tsx`** — a DOM smoke test so the jsdom path is exercised:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@telegram-web-client/pages';

describe('App (scaffold stub)', () => {
  it('renders the app title', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Telegram Web Client' })).toBeDefined();
  });
});
```

(`App` must be a named export for this to work — export both named and default if convenient.)

### 7.6 `.github/`

**Copy verbatim (no edits, keep their `# $version:`/`# vN-…` header comments so future diffs against AWS-AccessBridge stay clean):**

- `.github/actions/setup-env/action.yml` — pnpm + Node 24 + cached `pnpm install` wrapped in retry.
- `.github/actions/retry-step/action.yml` — retry wrapper; note it reads `$RETRY_COMMAND`, which the strategy sets internally.
- `.github/workflows/backup-main.yml` — mirrors `main` to Azure DevOps / GitLab when backup secrets are configured; with no
  secrets it exits green (check-secrets job gates everything).
- `.github/workflows/scheduled-version-update.yml` — twice-monthly `.github/.version` timestamp bump; `contents: write`.
- `.github/dependabot.yml` — weekly npm updates at `/`.

**Copy with one edit:**

- `.github/workflows/upstream-sync.yml` — change `upstream_sync_repo: Rexezuge-CloudflareWorkers/AWS-AccessBridge` to
  `Rexezuge-CloudflareWorkers/Telegram-Web-Client`. The job only runs when `github.event.repository.fork` is true, so on this
  repo it is dormant — that matches every sibling repo (each names *itself*, for their fork copies).

**New file:**

- `.github/.version` — seed with the current unix timestamp, e.g. `date +%s > .github/.version` (the scheduled workflow overwrites
  it; the file must exist so the first run has something to diff).

**Adapted: `.github/workflows/continuous-integration.yml`** — full content (this is authoritative; the implementer may pull still-valid
explanatory comments over from the AWS file while deleting the ones for removed jobs):

```yaml
name: Continuous Integration

permissions:
  contents: read

on:
  repository_dispatch:
    types:
      - Upstream Sync Integration
  pull_request:
  push:
    branches:
      - main
  workflow_dispatch:

concurrency:
  group: continuous-integration-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # Typecheck and lint stay separate jobs, like AWS-AccessBridge: a failure names
  # the tool that broke and a retry re-runs only that half.
  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6

      - name: Setup Environment
        uses: ./.github/actions/setup-env

      - name: Run Typecheck
        uses: ./.github/actions/retry-step
        with:
          command: pnpm run typecheck
          max_attempts: '2'

  lint:
    name: Lint
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6

      - name: Setup Environment
        uses: ./.github/actions/setup-env

      - name: Run Lint
        uses: ./.github/actions/retry-step
        with:
          command: pnpm run lint
          max_attempts: '2'

  god-files:
    name: God Files
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6

      - name: Setup Environment
        uses: ./.github/actions/setup-env

      # Its own job: a file growing past the limit is invisible to typecheck,
      # lint, and the tests — they all pass on a 500-line component.
      - name: Check God Files
        uses: ./.github/actions/retry-step
        with:
          command: pnpm run check:god-files
          max_attempts: '2'

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6

      - name: Setup Environment
        uses: ./.github/actions/setup-env

      - name: Run Tests with Coverage
        uses: ./.github/actions/retry-step
        with:
          command: pnpm run test:coverage
          max_attempts: '2'

      - name: Upload Coverage Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 14

  # Only the SPA build. The worker is covered by the `typecheck` job
  # (`pnpm -r typecheck` reaches worker/); `wrangler deploy --dry-run` in CD is
  # what proves it bundles.
  build-web:
    name: Build Web App
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6

      - name: Setup Environment
        uses: ./.github/actions/setup-env

      - name: Build Web App
        run: pnpm --filter @telegram-web-client/pages build

  dependabot-auto-merge:
    if: ${{ github.event_name == 'pull_request' && github.event.pull_request.user.login == 'dependabot[bot]' && github.event.pull_request.state == 'open' && !github.event.repository.fork }}
    name: Auto-Merge Dependabot PR
    needs:
      - typecheck
      - lint
      - god-files
      - unit-tests
      - build-web
    permissions:
      contents: write
      pull-requests: write
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6

      - name: Enable Auto-Merge
        uses: ./.github/actions/retry-step
        with:
          command: gh pr merge --auto --merge "$PR_URL"
          max_attempts: '5'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_URL: ${{ github.event.pull_request.html_url }}

  dispatch-upstream-sync-deployment:
    if: ${{ github.event_name == 'repository_dispatch' && github.event.action == 'Upstream Sync' }}
    name: Dispatch Upstream Sync Deployment
    needs:
      - typecheck
      - lint
      - god-files
      - unit-tests
      - build-web
    permissions:
      contents: write
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6

      - name: Dispatch Deployment
        uses: ./.github/actions/retry-step
        with:
          command: >
            printf '{"event_type":"Upstream Sync Deployment","client_payload":{"branch":"%s","sha":"%s"}}\n'
            "$PAYLOAD_BRANCH" "$PAYLOAD_SHA"
            | gh api repos/${{ github.repository }}/dispatches --method POST --input -
          max_attempts: '2'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PAYLOAD_BRANCH: ${{ github.event.client_payload.branch || 'main' }}
          PAYLOAD_SHA: ${{ github.event.client_payload.sha || github.sha }}
```

Adaptation notes vs the AWS source:
- Job `name:` values (`Typecheck`, `Lint`, `God Files`, `Unit Tests`, `Build Web App`) become the required-check names — keep them stable.
- `dependabot-auto-merge` and `dispatch-upstream-sync-deployment` `needs:` lists were pruned to the five surviving jobs.
- The workflow **`name:` must stay exactly `Continuous Integration`** — `continuous-deployment.yml` triggers on `workflow_run` by
  that name. Do not rename the workflow, only its file content/jobs.

**Adapted: `.github/workflows/continuous-deployment.yml`** — full content:

```yaml
name: Continuous Deployment

permissions:
  contents: read

on:
  workflow_run:
    workflows:
      - Continuous Integration
    branches:
      - main
    types:
      - completed
  repository_dispatch:
    types:
      - Upstream Sync Deployment
  workflow_dispatch:

concurrency:
  group: continuous-deployment-${{ github.event.workflow_run.head_branch || github.event.client_payload.branch || github.ref }}
  cancel-in-progress: false

jobs:
  deploy-worker:
    if: ${{ github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch' || github.event.workflow_run.conclusion == 'success' }}
    name: Deploy Cloudflare Worker
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.event.client_payload.sha || github.sha }}

      # Uses the shared composite rather than inlining pnpm/node/install the way
      # the AWS-AccessBridge CD does; Pages-Reverse-Proxy's CD already set this
      # precedent.
      - name: Setup Environment
        uses: ./.github/actions/setup-env

      - name: Prepare Wrangler Configuration
        uses: ./.github/actions/retry-step
        with:
          command: pnpm exec tsx scripts/deploy/materialize-wrangler-config.ts
          max_attempts: '3'
        env:
          WRANGLER_JSONC: ${{ vars.WRANGLER_JSONC }}
          WRANGLER_PATCH_JSON: ${{ vars.WRANGLER_PATCH_JSON }}
          WRANGLER_VARS_PATCH_JSON: ${{ vars.WRANGLER_VARS_PATCH_JSON }}

      - name: Dry Run Deploy with Wrangler
        run: pnpm exec wrangler deploy --dry-run
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy with Wrangler
        uses: ./.github/actions/retry-step
        with:
          command: pnpm exec wrangler deploy
          max_attempts: '3'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy-pages:
    if: ${{ github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch' || github.event.workflow_run.conclusion == 'success' }}
    name: Deploy Cloudflare Pages
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v6
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.event.client_payload.sha || github.sha }}

      - name: Setup Environment
        uses: ./.github/actions/setup-env

      - name: Build Frontend
        run: pnpm --filter @telegram-web-client/pages build

      - name: Configure Pages Service Bindings
        run: cp pages/wrangler.template.jsonc wrangler.jsonc

      - name: Ensure Pages Project Exists
        run: |
          PROJECT="${CLOUDFLARE_PAGES_PROJECT_NAME:-telegram-web-client-web}"
          echo "Ensuring Pages project \"${PROJECT}\" exists..."
          if CREATE_OUTPUT="$(pnpm exec wrangler pages project create "${PROJECT}" --production-branch "${DEPLOY_BRANCH:-main}" 2>&1)"; then
            echo "Created Pages project \"${PROJECT}\"."
          elif echo "${CREATE_OUTPUT}" | grep -qi "already exists"; then
            echo "Pages project \"${PROJECT}\" already exists."
          else
            echo "${CREATE_OUTPUT}"
            echo "Failed to create Pages project \"${PROJECT}\"." >&2
            exit 1
          fi
          echo "Waiting for Pages project \"${PROJECT}\" to become visible..."
          VISIBLE=0
          for _ in $(seq 1 18); do
            if pnpm exec wrangler pages project list 2>/dev/null | grep -qE "(^|[[:space:]])${PROJECT}([[:space:]]|$)"; then
              VISIBLE=1
              break
            fi
            sleep 5
          done
          if [ "${VISIBLE}" -ne 1 ]; then
            echo "Pages project \"${PROJECT}\" is still not visible after polling." >&2
            exit 1
          fi
          echo "Pages project \"${PROJECT}\" is ready."
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_PAGES_PROJECT_NAME: ${{ vars.CLOUDFLARE_PAGES_PROJECT_NAME || 'telegram-web-client-web' }}
          DEPLOY_BRANCH: ${{ github.event.workflow_run.head_branch || github.event.client_payload.branch || github.ref_name }}

      - name: Deploy with Wrangler Pages
        uses: ./.github/actions/retry-step
        with:
          command: >
            pnpm exec wrangler pages deploy pages/dist
            --project-name "${CLOUDFLARE_PAGES_PROJECT_NAME:-telegram-web-client-web}"
            --branch "${DEPLOY_BRANCH}"
            --commit-hash "${DEPLOY_SHA}"
            --commit-message "$(git log -1 --pretty=%s)"
          max_attempts: '3'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_PAGES_PROJECT_NAME: ${{ vars.CLOUDFLARE_PAGES_PROJECT_NAME || 'telegram-web-client-web' }}
          DEPLOY_BRANCH: ${{ github.event.workflow_run.head_branch || github.event.client_payload.branch || github.ref_name }}
          DEPLOY_SHA: ${{ github.event.workflow_run.head_sha || github.event.client_payload.sha || github.sha }}
```

Adaptation notes vs the AWS source:
- **Removed from `deploy-worker`:** inline install steps (replaced by `setup-env`), "Initialize Cloudflare Secrets Store"
  (deferred, §3.6), "Apply Database Migration" (no D1), "Build Web App" (worker is API-only), "Prepare for Deploy"
  (open-next/next-config workarounds — AWS legacy, meaningless here).
- The two jobs run **in parallel** by design (user chose "one CD, two jobs"); no `needs:` between them. `cancel-in-progress: false`
  matches the source: a deploy in flight must not be cancelled mid-run.
- Both `if:` gates and every `ref:` fallback chain are copied exactly from AWS so `workflow_dispatch`, `repository_dispatch`, and
  `workflow_run` all resolve a SHA.

## 8. GitHub Repo Settings Checklist

Set these on `Rexezuge-CloudflareWorkers/Telegram-Web-Client` **before merging the scaffold PR**, so the first CD run after merge
succeeds (otherwise: merge → CI green → CD fails on missing secrets → configure → "Re-run all jobs" on the CD run; recoverable but
noisy).

**Actions secrets (required):**

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers Scripts:Edit + Pages:Edit, scoped to the account (Workers Scripts:Edit covers Durable Objects) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |

**Actions secrets (optional — absent ⇒ `backup-main.yml` jobs skip and stay green):** `BACKUP_REPO_AZURE_DEVOPS_SSH_KEY`,
`BACKUP_REPO_AZURE_DEVOPS_REPO_URL`, `BACKUP_REPO_GITLAB_SSH_KEY`, `BACKUP_REPO_GITLAB_REPO_URL`.

**Actions variables (all optional):**

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | Overrides the default `telegram-web-client-web` |
| `WRANGLER_JSONC` | Full wrangler config override (replaces the worker template) |
| `WRANGLER_PATCH_JSON` | Top-level patch merged onto the worker config |
| `WRANGLER_VARS_PATCH_JSON` | Patch merged into the config's `vars` |

**Repository settings:**

- Enable **Allow auto-merge** (the `dependabot-auto-merge` job depends on it).
- Keep default `GITHUB_TOKEN` permissions minimal; the two tail jobs request `contents: write` at job level — make sure no org
  policy blocks that.
- After the first CI run appears, set branch protection on `main` with required status checks: **Typecheck**, **Lint**,
  **God Files**, **Unit Tests**, **Build Web App**.
- Optional: Dependabot alerts on.

## 9. Local Verification (run before pushing)

Use the house toolchain invocation (`source ~/.customrc` first if not already; `volta run pnpm …` if Volta is active):

```bash
pnpm install                                   # must generate pnpm-lock.yaml + worker-configuration.d.ts (postinstall)
pnpm run typecheck                             # -r typecheck + scripts typecheck
pnpm run lint                                  # eslint --fix --quiet .
pnpm run check:god-files                       # 0 errors, at most warnings
pnpm run test:coverage                         # both smoke tests pass; coverage/ written
pnpm --filter @telegram-web-client/pages build # pages/dist/index.html exists
pnpm exec tsx scripts/deploy/materialize-wrangler-config.ts
pnpm exec wrangler deploy --dry-run            # bundles worker; no auth needed
pnpm exec wrangler pages deploy pages/dist --dry-run   # validates Pages config; no auth needed (if flag supported)
git status                                     # wrangler.jsonc + worker-configuration.d.ts must appear as IGNORED, not untracked
```

Acceptance criteria:
1. All commands above succeed on a clean checkout.
2. `wrangler.jsonc` is not tracked; `worker-configuration.d.ts` is not tracked; `pnpm-lock.yaml` **is** tracked.
3. Pushing the branch produces a green CI run (all five jobs + the two tail jobs skipped-by-condition).
4. After repo settings (§8) and merge: CD creates the `telegram-web-client` worker, creates the
   `telegram-web-client-web` Pages project, and deploys both; `https://<worker>.workers.dev/health` returns
   `{"status":"ok","service":"telegram-web-client"}`; the Pages URL serves the scaffold UI.

## 10. Implementation Sequence

1. `git switch main && git pull` (or verify `main` is current), then `git switch -c feat/repo-scaffold` — the house policy is
   **never commit straight to `main`**; branch first.
2. Apply this plan; suggested commit split (house format: `<TYPE>: <Description In Title Case>`, body, then AI attribution
   footers `Harness: OpenCode` and `Model-ID: <your providerID/modelID>` — the planning session used
   `opencode/deepseek-v4.1-flash-free`; use your own):
   1. `BUILD: Add Workspace Tooling And Root Configuration` — root configs, `scripts/`, first `pnpm install` lockfile.
   2. `FEAT(worker): Add Worker Skeleton With Durable Object Stub` — `worker/**`.
   3. `FEAT(pages): Add Pages SPA Skeleton And Service Binding` — `pages/**`.
   4. `TEST: Add Smoke Tests For Worker And Pages` — `test/**`.
   5. `CI: Mirror AWS-AccessBridge Workflow Suite` — `.github/**` + `scripts/deploy/materialize-wrangler-config.ts` (or fold the
      materializer into commit 1; either is fine, keep each commit self-consistent).
   6. `DOCS: Add Project README And Agent Guide` — `README.md`, `AGENTS.md`, `CLAUDE.md` symlink; **delete `PLAN.md`** in this
      commit once its durable content lives in README/AGENTS.
3. Run §9 verification.
4. Push the branch, open a PR.
5. Configure repo settings per §8 **before merge**.
6. Merge → CI on `main` → CD deploys worker + Pages → verify §9 acceptance criteria 4.
7. Add required status checks (§8) after the first CI run has produced the check names.

Commit footers example (the implementing agent substitutes its own Model-ID):

```
CI: Mirror AWS-AccessBridge Workflow Suite

Port the AWS-AccessBridge GitHub workflow suite to this repository:
adapted continuous-integration and single-CD/two-jobs
continuous-deployment, verbatim backup-main, scheduled-version-update,
upstream-sync and dependabot, plus the shared composite actions.

Harness: OpenCode
Model-ID: opencode/deepseek-v4.1-flash-free
```

## 11. Pitfalls & Lessons Carried Over (read before implementing)

1. **`wrangler.jsonc` is materialized, never committed.** Every path inside both templates is relative to the repo root, because
   the file is copied to the root before `wrangler deploy` / `wrangler pages deploy` runs. `git status` after a local deploy must
   show it as ignored.
2. **The workflow *name* `Continuous Integration` is load-bearing.** CD's `workflow_run` filter matches by name, not filename.
3. **Pages Functions directory constraint:** if Pages Functions are added later, they belong at repo-root `functions/`, not under
   `pages/` — same reason as ¶1 (the config that wrangler reads sits at the root). AWS-AccessBridge's root `functions/` exists for
   exactly this reason.
4. **pnpm strictness:** `test/` must stay a workspace package; a bare import that fails to resolve means "add the dependency to
   `test/package.json`", never "move test/ out of the workspace" (AWS-AccessBridge documented this after it bit).
5. **`postinstall` runs `typegen`:** a fresh clone has no `worker-configuration.d.ts` until `pnpm install` completes; CI's
   `setup-env` handles this. Do not commit the generated file.
6. **pnpm 11 build-script allowlist:** `allowBuilds: { esbuild, workerd }` in `pnpm-workspace.yaml` is required or the binaries
   Vite/Vitest/Wrangler need are silently not built.
7. **DO migrations:** the `v1` migration tag with `new_sqlite_classes: ["SessionEngine"]` must be present on the very first deploy
   of the DO; renaming the class or the binding later requires a new migration tag, so only change them deliberately.
8. **The DO stub deliberately avoids `import { DurableObject } from 'cloudflare:workers'`** so Vitest can import it without the
   Workers test pool. Keep it that way until `@cloudflare/vitest-pool-workers` is added for real DO tests.
9. **`.github/.version` must be seeded** or the first scheduled run's diff handling is confusing.
10. **`upstream-sync.yml` is dormant** unless the GitHub repo is a fork (`if: github.event.repository.fork`); the self-referential
    upstream name matches the sibling-repo convention.
11. **The `dependabot-auto-merge` job requires the repo auto-merge setting**; without it the job fails on every Dependabot PR.
12. **Keep the CI `retry-step` wrappers** around network-ish commands (`pnpm install`, tests, deploys) — that is the house pattern;
    `max_attempts: '2'` on checks absorbs flaky installs without hiding real failures.
13. **Do not port AWS-only machinery**: no `assets`/`spa-shell`/open-next handling, no D1 migrations step, no Secrets Store init,
    no `scripts/backup/**`. This repo's worker is a pure API worker.
14. **`pnpm run lint` uses `--fix`:** run it locally and commit any fixes before pushing, or CI will lint-fix in place and still
    report remaining errors.

## 12. Out of Scope / Next Phases

For orientation only — none of this is scaffold work:

1. **Session-engine spike (the real risk):** mtcute `@codehs/mtproto`-style core inside a DO — custom storage over DO SQLite,
   WSS transport to `wss://{pluto|venus|aurora|vesta|flora}.web.telegram.org:443/apiws`, QR login, one full
   connect → `getDifference` → persist → disconnect → alarm cycle, logging CPU per wake against the Free-plan 10 ms/invocation
   limit. Do this before building UI.
2. **72 h soak:** 5-minute alarm cadence; count failed wakes; watch duration/rows/storage against Free-tier limits.
3. **UI fork:** `telegram-tt` fork under `pages/`, with a remote-session bridge to the worker: `POST /rpc`, `WS /updates`,
   `GET /file/*` streaming; chunked upload relay for large files (Workers request-body cap ~100 MB on Free/Pro).
4. **API routing:** decide direct worker domain vs Pages Functions proxy at root `functions/` (the `API_WORKER` service binding is
   already provisioned for the latter). WebSockets through Pages Functions deserve an early spike if chosen.
5. **Web Push / search / access lockdown, Secrets Store init, DO storage backups, locales/god-file thresholds tuning, coverage
   floor, integration tests, `@cloudflare/vitest-pool-workers` for worker tests, `sharp` if image tooling appears.**
6. **Observability:** consider Workers Logs / Tail Workers for wake telemetry before the soak test.

## 13. Reference Map (new file ← source)

| New path | Source |
| --- | --- |
| `.github/actions/*` | `AWS-AccessBridge/.github/actions/*` (verbatim) |
| `.github/dependabot.yml` | same (verbatim) |
| `.github/workflows/backup-main.yml`, `scheduled-version-update.yml` | same (verbatim) |
| `.github/workflows/upstream-sync.yml` | same + upstream name edit |
| `.github/workflows/continuous-integration.yml` | same, adapted per §7.6 |
| `.github/workflows/continuous-deployment.yml` | same, adapted per §7.6 |
| root `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `.prettierrc`, `.editorconfig`, `.npmrc`, `eslint.config.mjs` | `AWS-AccessBridge/*` (adapted per §7.1) |
| `scripts/check-god-files.mjs` | same (verbatim) |
| `scripts/tsconfig.json` | `AWS-AccessBridge/scripts/tsconfig.json` (adapted) |
| `scripts/deploy/materialize-wrangler-config.ts` | new, slim (AWS's `prepare-wrangler-config.ts` + `scripts/lib/wrangler-config/*` as inspiration only) |
| `worker/*` | new skeleton; `AWS-AccessBridge/apps/api/wrangler.template.jsonc` as template reference |
| `pages/*` | new skeleton; `AWS-AccessBridge/apps/web/{tsconfig.json,vite.config.ts}` as references |
| `test/*` | new; `AWS-AccessBridge/pnpm-workspace.yaml` comment explains the workspace-membership requirement |

## 14. Open Items (decide while implementing, don't block)

- `pages/package.json` `@types/node` caret (`^26.4.4`) — align with whatever pnpm resolves; root pins `26.6.4`.
- Whether to fold `scripts/deploy/materialize-wrangler-config.ts` into an EARLIER commit than the CI one (see §10).
- Whether `PLAN.md` is deleted on landing (recommended, §10.2.6) or kept as history.
- Seeding the repo with `WRANGLER_PATCH_JSON`/`WRANGLER_VARS_PATCH_JSON` is unnecessary at scaffold time; leave unset.
- Cloudflare account choice for the first deploy (user-side; secrets must come from the same account that will host the worker).
