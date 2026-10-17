# Telegram Web Client

An always-online Telegram web client hosted on Cloudflare:

- **`worker/`** — the backend. A Hono API and, in phase 1, a Durable Object (`SessionEngine`) that is the single home of
  one Telegram account's MTProto session: it wakes on an alarm every few minutes, connects to Telegram over WSS, replays
  `getDifference`, persists to DO SQLite, disconnects, and re-arms its own alarm.
- **`pages/`** — the frontend. A Vite + React SPA that talks to the worker over HTTP. It will grow into a fork of
  [`telegram-tt`](https://github.com/PBhadoo/telegram-tt) wired to the worker through a small RPC bridge.

**Status: scaffold.** The workspace layout, tooling gates, and the family's CI/CD suite are in place, with a
minimal-but-real worker (health route + DO stub) and Pages skeleton so every workflow starts green. Product work is
listed under [Where this is going](#where-this-is-going).

## Layout

| Path       | What                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `worker/`  | Worker package: `src/index.ts` (Hono entry, exports the DO class) and `src/session-engine.ts` (stub)      |
| `pages/`   | Pages package: Vite + React SPA (`src/`), `wrangler.template.jsonc` with the `API_WORKER` service binding |
| `test/`    | Vitest suite as a workspace package; `test/web/**` is the SPA half, everything else is the worker half    |
| `scripts/` | `check-god-files.ts` and `prepare-wrangler-config.ts`, copied from `@rexezuge/tooling` (see `AGENTS.md`)  |
| `.github/` | CI, CD, mirror/backup, version-stamp, upstream-sync workflows and the two composite actions               |

`wrangler.jsonc` is **materialized to the repo root** by `scripts/prepare-wrangler-config.ts` before dev/deploy — the
templates live in `worker/` and `pages/` and every path inside them is root-relative. `wrangler.jsonc` and the generated
`worker-configuration.d.ts` are gitignored and never committed.

## Requirements

- Node 24 (this machine manages it with Volta; the repo pins `pnpm@11.2.2` via `packageManager`)
- Cloudflare account with Workers + Pages for deploys

## Commands

```bash
pnpm install          # installs deps and generates worker-configuration.d.ts (postinstall → typegen)
pnpm run checks:fast  # typecheck (packages + scripts) | lint (eslint --fix) | format:check | god-files
pnpm run test         # vitest run
pnpm run test:coverage
pnpm run build        # builds every package (the SPA)
```

### Local development

```bash
# Worker on http://localhost:8787 (materializes wrangler.jsonc first):
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler dev

# SPA on http://localhost:5173 — /api is proxied to the worker above:
pnpm --filter @telegram-web-client/pages dev
```

## CI and deployment

- **Continuous Integration** (`.github/workflows/continuous-integration.yml`) runs on PRs, pushes to `main`, and
  upstream-sync dispatches. Jobs: **Checks** (typecheck + lint, formatting, god-files), **Unit Tests** (coverage artifact),
  **Build Web App**, plus the two tail jobs (Dependabot auto-merge, upstream-sync deployment dispatch).
- **Continuous Deployment** (`.github/workflows/continuous-deployment.yml`) runs after CI succeeds on `main`, with
  `deploy-worker` and `deploy-pages` in parallel. The worker deploy materializes `wrangler.jsonc`, runs
  `wrangler deploy --dry-run` as a gate, then deploys; the Pages deploy builds the SPA, creates the Pages project if
  absent, and deploys.

### Repository settings (set before merging the first scaffold PR)

| Kind                | Name                                                                  | Purpose                                                  |
| ------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Secret              | `CLOUDFLARE_API_TOKEN`                                                | Workers Scripts:Edit + Pages:Edit, scoped to the account |
| Secret              | `CLOUDFLARE_ACCOUNT_ID`                                               | Cloudflare account id                                    |
| Variable (optional) | `CLOUDFLARE_PAGES_PROJECT_NAME`                                       | Overrides the default `telegram-web-client-web`          |
| Variable (optional) | `WRANGLER_JSONC` / `WRANGLER_PATCH_JSON` / `WRANGLER_VARS_PATCH_JSON` | Per-environment wrangler overrides                       |

Also: enable **Allow auto-merge** (the Dependabot job depends on it), and after the first CI run set branch protection
on `main` with required checks **Checks**, **Unit Tests**, **Build Web App**.

### First-deploy verification

1. Merge the scaffold PR; CI on `main` goes green and CD starts.
2. CD creates the `telegram-web-client` worker and the `telegram-web-client-web` Pages project, then deploys both.
3. `https://telegram-web-client.<your-subdomain>.workers.dev/health` returns
   `{"status":"ok","service":"telegram-web-client"}`; the Pages URL serves the scaffold UI.

## Where this is going

1. **Session-engine spike** — MTProto (WSS transport) inside the Durable Object, QR login, one
   connect → `getDifference` → persist → disconnect → alarm cycle, with CPU per wake measured against the Free-plan
   10 ms/invocation limit.
2. **72 h soak** — 5-minute alarm cadence; watch duration/rows/storage against Free-tier limits.
3. **UI fork** — `telegram-tt` under `pages/` with a remote-session bridge: `POST /rpc`, `WS /updates`, `GET /file/*`.
4. **API routing** — direct worker domain or a Pages Functions proxy at repo-root `functions/` (the `API_WORKER` service
   binding is already provisioned for the latter).

`AGENTS.md` records the architecture invariants, the workflow/secret table, and the lessons carried over from the
sibling repositories.
