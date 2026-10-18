# AGENTS.md

Index for agents and humans working in this repository. Read `README.md` for the product overview and commands; this
file records the architecture, the load-bearing invariants, and the house conventions.

## Overview

**Telegram-Web-Client** is an always-online Telegram web client on Cloudflare. The worker (`worker/`) is the backend —
a Hono API and a Durable Object (`SessionEngine`) that owns one Telegram account's MTProto session: a 5-minute alarm
wakes it to connect, replay `getDifference`, persist to DO SQLite and disconnect (the always-reachable baseline), and
while a browser socket is attached it holds the session live and pushes updates. The Pages app (`pages/`) is the Vite +
React front end (QR login, chat list, threads), and the Pages Function (`functions/`) proxies `/api/*` to the worker
over a service binding so the worker never faces the internet. One account, single user, Free-tier-first: the 10 ms CPU
per invocation limit is the constraint the session engine is measured against. `docs/session-engine.md` is the engine's
runbook.

## Commands

House toolchain: Node 24 and pnpm 11.2.2 are Volta-managed (`~/.customrc` is sourced by the login shell; `volta run`
honours the `packageManager` pin). Every command below also works as `volta run pnpm …`.

| Command                           | What it does                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm install`                    | Installs the workspace and runs `postinstall` → `pnpm run typegen`                      |
| `pnpm run typegen`                | Regenerates `worker-configuration.d.ts` from `worker/wrangler.template.jsonc`           |
| `pnpm run typecheck`              | `pnpm -r typecheck` (worker, pages, test) + `typecheck:scripts` + `typecheck:functions` |
| `pnpm run lint`                   | `eslint --fix --quiet .` under `--max-old-space-size=6144`                              |
| `pnpm run format:check`           | `prettier --check .` (read-only; the CI formatting gate)                                |
| `pnpm run check:god-files`        | 300-line warn / 400-line hard gate (`--fail-on-hard`), tests and `scripts/` exempt      |
| `pnpm run test` / `test:coverage` | Vitest, both projects (worker under `node`, SPA under jsdom)                            |
| `pnpm run checks:fast`            | typecheck + lint + format:check + god-files                                             |
| `pnpm run checks`                 | `checks:fast` + `test:coverage`                                                         |

Local dev: `cp .dev.vars.example .dev.vars` (secrets are gitignored), materialize the config
(`pnpm exec tsx scripts/prepare-wrangler-config.ts`), then `pnpm exec wrangler dev` (worker, port 8787) and
`pnpm --filter @telegram-web-client/pages dev` (SPA, port 5173, `/api` proxied to the worker).

## Architecture & invariants

### Layout

- `worker/` — the API worker. `src/index.ts` is the Hono entry (health, the `SPIKE_TOKEN` gate on `/api/*`, forwarding
  to the DO) and re-exports `SessionEngine`; wrangler discovers the DO class through that export. `src/session/` holds
  the engine (`engine.ts`), its bridge modules (`rpc`, `dto`, `params`, `updates`, `media`, `comments`, `stats`,
  `login-flow`, `driver`, `http`, `socket-hub`) and the mtcute integration (`mtproto/{client,crypto,transport,sqlite,platform}.ts`).
  The bridge contract is `src/types.ts` (the DTOs) plus `src/rpc-types.ts` (the RPC method shapes), both mirrored in
  the SPA. `wrangler.template.jsonc` declares the DO binding (`SESSION_ENGINE`), the `v1` SQLite migration,
  `workers_dev: false` and `WAKE_INTERVAL_SECONDS`.
- `pages/` — the SPA. `wrangler.template.jsonc` has the `pages_build_output_dir` and the `API_WORKER` service binding
  (consumed by `functions/`); `src/` is the React app (`api.ts` is the bridge client, `state.ts` the chat-list
  reducers, `useComments.ts` the comments screen's controller, `components/` the screens).
- `functions/` — Pages Functions, always at the **repo root** (not under `pages/`), because the config wrangler reads
  for them is the materialized root `wrangler.jsonc`. `api/[[path]].ts` is a pass-through to `env.API_WORKER`; it must
  not import workspace packages (Pages bundles it separately).
- `docs/` — `session-engine.md`: engine architecture, bridge API table, local dev, M1 spike + M2 soak runbooks,
  troubleshooting.
- `test/` — a **workspace package**, deliberately: an unhooked out-of-workspace `test/` cannot resolve workspace
  dependencies under pnpm's strict layout. If a bare import fails, add the dependency to `test/package.json` — never loosen
  the workspace.
- `scripts/` — copies of `@rexezuge/tooling`'s entrypoints (`check-god-files.ts`, `prepare-wrangler-config.ts`) plus their
  import closure (`lib/`, `wrangler-config/`). They are copies on purpose (the kit documents repository-local copies as the
  intended use) and carry two local adaptations, both marked with an "Adapted from the kit" comment:
  1. `wrangler-config/types.ts` — the template default is `worker/wrangler.template.jsonc`.
  2. `prepare-wrangler-config.ts` — `provisionWranglerResources({})`, because this worker has no KV cache binding and must
     not have the family default (`CACHE`) added to its config.
     On a `@rexezuge/tooling` bump, diff and re-sync these files.

### Load-bearing details

- **`wrangler.jsonc` is materialized at the repo root, never committed.** Both templates and every path inside them are
  root-relative for that reason; the Pages Functions in repo-root `functions/` are discovered because the config wrangler
  reads for them sits at the root.
- **`worker-configuration.d.ts` is generated and gitignored.** `postinstall` writes it, so a fresh clone always has the
  `CloudflareEnv` interface and the Workers globals before `tsc` runs. Never commit it.
- **DO migrations are one-way doors.** The `v1` tag with `new_sqlite_classes: ["SessionEngine"]` must be present on the
  first deploy; renaming the class or the binding later requires a new migration tag. Only change them deliberately.
- **The DO stub is a plain class**, not `extends DurableObject` — that import cannot resolve under Vitest's runtime
  without `@cloudflare/vitest-pool-workers`, and a DO class does not need to extend it. Keep it that way until real DO
  tests exist.
- **The worker is API-only.** No `assets`, no `spa-shell` embedding, no open-next workarounds, and no D1 — the session
  engine's storage is the Durable Object's SQLite. The UI lives on Pages.
- **The worker is not publicly routable.** `workers_dev: false` and no route: the only caller is the Pages Function
  (`API_WORKER` service binding). Until Cloudflare Access guards the Pages domain, every `/api/*` route is gated by the
  `SPIKE_TOKEN` secret (`x-session-token` header, or `?token=` for socket upgrades); the SPA asks for it on a 401
  `{"code":"gate"}` and stores it in localStorage. Delete the secret once Access is in place.
- **Storage is mtcute's `BaseSqliteStorage` over the DO's SQLite.** `session/mtproto/sqlite.ts` adapts `ctx.storage.sql`
  to `ISqliteDatabase` (`transactionSync` backs mtcute's `driver.save()`); engine-owned tables are prefixed `engine_`.
  There is no history backfill — session, update state and small caches only; history and media are fetched live through
  the bridge.
- **Media routes are gated too.** `<img>`/`<video>`/`<audio>` cannot set headers, so `/api/file` and `/api/avatar`
  accept the token as `?token=` (the SPA appends it). `POST /api/upload` takes the file as the raw request body,
  streams it straight into mtcute's upload pool, and is capped by `UPLOAD_MAX_BYTES` (default 100 MB) — that var is
  also the upload-CPU affordability knob. The upload query is validated a second time in the outer worker (same
  parser, `worker/src/index.ts`): workerd reads a request stream after its response when a Durable Object answers
  without consuming the body (cloudflare/workerd#918), so malformed and oversized uploads must never reach it.
- **Sockets use the hibernation API**, so the DO can sleep while a tab is attached; the wire protocol lives in
  `session/socket-hub.ts`. `WebSocketPair` only exists under workerd, which is why the `/api/updates` accept path has no
  unit test — it is covered by the local smoke test.
- **The wasm crypto module is a static import** (`@mtcute/wasm/mtcute.wasm`, instantiated with `initSync`); wrangler's
  default `CompiledWasm` rule bundles it and `wrangler deploy --dry-run` is the check. If a wake's startup CPU ever gets
  tight, move the import behind a dynamic import rather than touching mtcute.
- **Secrets are declared by hand in `worker/src/env.d.ts`.** The generated `worker-configuration.d.ts` only knows the
  bindings and vars in the template, so `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`SPIKE_TOKEN` are augmented there; any
  tsconfig whose program uses them must include that file (`test/tsconfig.json` does).
- **The test partition is a convention:** the SPA suite lives in `test/web/**` (the `defineRepoVitestConfig` web project's
  shape); everything else in `test/` runs under `node` as the backend half.
- **The CI workflow's `name:` is `Continuous Integration`** — CD's `workflow_run` trigger matches by workflow _name_, not
  filename. Job names (`Checks`, `Unit Tests`, `Build Web App`) are the required-check names; keep them stable.
- **`pnpm run lint` uses `--fix`.** Run it locally and commit its fixes; CI's `--quiet` discards warnings, which is why the
  separate `format:check` step exists.
- **`minimumReleaseAge: 0` lives in `pnpm-workspace.yaml`.** pnpm 11 reads settings from there, not `.npmrc`; without it the
  default 24-hour window blocks installing a just-published `@rexezuge/tooling` release.

## Workflows

| Workflow                       | Trigger                                    | What it does                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `continuous-integration.yml`   | PR, push to `main`, upstream-sync dispatch | `Checks` (typecheck+lint, format:check, god-files), `Unit Tests` (+coverage artifact), `Build Web App`; Dependabot auto-merge and upstream-sync deployment dispatch as tail jobs |
| `continuous-deployment.yml`    | CI success on `main`, manual dispatch      | `deploy-worker` (materialize config → dry-run gate → deploy) and `deploy-pages` (build → ensure project → deploy) in parallel                                                    |
| `backup-main.yml`              | push to `main`, monthly                    | Mirrors the repo to Azure DevOps / GitLab — opt-in by secrets; skips green when unset                                                                                            |
| `scheduled-version-update.yml` | 1st and 15th                               | Stamps `.github/.version` with the current unix timestamp                                                                                                                        |
| `upstream-sync.yml`            | weekly, manual                             | Dormant here (`if: github.event.repository.fork`); a fork of this repo points it at this repo                                                                                    |

Secrets/variables and the branch-protection checklist live in `README.md` (required settings) and are mirrored in the
workflow files themselves.

## Where this is going / out of scope

The session engine, the bridge (`POST /api/rpc`, `WS /api/updates`, the media routes `GET /api/file`,
`GET /api/avatar`, `POST /api/upload`) and the Pages proxy are in place; what remains needs the owner. In order:
(1) **M1 acceptance** — real QR login against the account, one measured wake cycle — after `api_id`/`api_hash`
exist; (2) the **72 h soak** at the 300 s cadence once the deployment is up; (3) the **`telegram-tt` fork** behind
the existing bridge contract, which also needs the domain + Cloudflare Access setup so the interim `SPIKE_TOKEN`
gate can be removed. Both acceptance milestones run per `docs/session-engine.md`. Later concerns:
Secrets Store initialization, DO storage backups, coverage floors, integration tests, and
`@cloudflare/vitest-pool-workers` once real DO tests exist.

## Keeping AGENTS.md current

Update this file when a change moves a boundary: a new workspace package, a new workflow or secret, a changed
materialization path, a changed test partition, or a copied script diverging further from the kit. The file is the index;
the reasoning belongs beside the code it explains.
