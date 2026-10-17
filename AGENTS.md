# AGENTS.md

Index for agents and humans working in this repository. Read `README.md` for the product overview and commands; this
file records the architecture, the load-bearing invariants, and the house conventions.

## Overview

**Telegram-Web-Client** is an always-online Telegram web client on Cloudflare. The worker (`worker/`) is the backend —
a Hono API and a Durable Object (`SessionEngine`) that will own one Telegram account's MTProto session, waking on an
alarm to replay `getDifference` and persisting to DO SQLite. The Pages app (`pages/`) is the Vite + React front end that
talks to the worker over HTTP. One account, single user, Free-tier-first: the 10 ms CPU per invocation limit is the
constraint the session engine will be measured against.

## Commands

House toolchain: Node 24 and pnpm 11.2.2 are Volta-managed (`~/.customrc` is sourced by the login shell; `volta run`
honours the `packageManager` pin). Every command below also works as `volta run pnpm …`.

| Command                           | What it does                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm install`                    | Installs the workspace and runs `postinstall` → `pnpm run typegen`                 |
| `pnpm run typegen`                | Regenerates `worker-configuration.d.ts` from `worker/wrangler.template.jsonc`      |
| `pnpm run typecheck`              | `pnpm -r typecheck` (worker, pages, test) + `typecheck:scripts`                    |
| `pnpm run lint`                   | `eslint --fix --quiet .` under `--max-old-space-size=6144`                         |
| `pnpm run format:check`           | `prettier --check .` (read-only; the CI formatting gate)                           |
| `pnpm run check:god-files`        | 300-line warn / 400-line hard gate (`--fail-on-hard`), tests and `scripts/` exempt |
| `pnpm run test` / `test:coverage` | Vitest, both projects (worker under `node`, SPA under jsdom)                       |
| `pnpm run checks:fast`            | typecheck + lint + format:check + god-files                                        |
| `pnpm run checks`                 | `checks:fast` + `test:coverage`                                                    |

Local dev: materialize the config (`pnpm exec tsx scripts/prepare-wrangler-config.ts`), then `pnpm exec wrangler dev`
(worker, port 8787) and `pnpm --filter @telegram-web-client/pages dev` (SPA, port 5173, `/api` proxied to the worker).

## Architecture & invariants

### Layout

- `worker/` — the API worker. `src/index.ts` is the Hono entry and re-exports `SessionEngine`; wrangler discovers the
  DO class through that export. `wrangler.template.jsonc` declares the DO binding (`SESSION_ENGINE`) and the `v1` SQLite
  migration.
- `pages/` — the SPA. `wrangler.template.jsonc` has the `pages_build_output_dir` and the inert `API_WORKER` service
  binding (inert until Pages Functions exist).
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
  root-relative for that reason. If Pages Functions are ever added, they must live at repo-root `functions/` — not under
  `pages/` — because the config wrangler reads sits at the root.
- **`worker-configuration.d.ts` is generated and gitignored.** `postinstall` writes it, so a fresh clone always has the
  `CloudflareEnv` interface and the Workers globals before `tsc` runs. Never commit it.
- **DO migrations are one-way doors.** The `v1` tag with `new_sqlite_classes: ["SessionEngine"]` must be present on the
  first deploy; renaming the class or the binding later requires a new migration tag. Only change them deliberately.
- **The DO stub is a plain class**, not `extends DurableObject` — that import cannot resolve under Vitest's runtime
  without `@cloudflare/vitest-pool-workers`, and a DO class does not need to extend it. Keep it that way until real DO
  tests exist.
- **The worker is API-only.** No `assets`, no `spa-shell` embedding, no open-next workarounds, and no D1 — the session
  engine's storage is the Durable Object's SQLite. The UI lives on Pages.
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

Product work, in the order it should happen (details in `README.md`): the session-engine spike (MTProto over WSS inside
the DO, QR login, one alarm cycle, CPU measured), the 72 h soak, the `telegram-tt` fork with the RPC bridge
(`POST /rpc`, `WS /updates`, `GET /file/*`), and the API-routing decision (worker domain vs Pages Functions proxy at root
`functions/`). Later concerns: Secrets Store initialization, DO storage backups, coverage floors, integration tests, and
`@cloudflare/vitest-pool-workers` once real DO tests exist.

## Keeping AGENTS.md current

Update this file when a change moves a boundary: a new workspace package, a new workflow or secret, a changed
materialization path, a changed test partition, or a copied script diverging further from the kit. The file is the index;
the reasoning belongs beside the code it explains.
