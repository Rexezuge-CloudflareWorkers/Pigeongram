# Telegram Web Client

An always-online Telegram web client hosted on Cloudflare:

- **`worker/`** — the backend. A Hono API and a Durable Object (`SessionEngine`) that is the single home of one
  Telegram account's MTProto session: it wakes on an alarm every few minutes, connects to Telegram over WSS, replays
  `getDifference`, persists to DO SQLite, disconnects, and re-arms its own alarm. While a browser tab is attached it
  holds the session live and pushes updates. See [`docs/session-engine.md`](docs/session-engine.md).
- **`pages/`** — the frontend. A Vite + React SPA (login by QR, chat list, threads, live updates) that talks to the
  worker through the bridge. It will grow into a fork of
  [`telegram-tt`](https://github.com/PBhadoo/telegram-tt) wired to the same bridge.
- **`functions/`** — the Pages Function proxying `/api/*` to the worker over the `API_WORKER` service binding, so the
  worker itself never has to be reachable from the internet.

**Status: milestone 1 code complete, acceptance pending.** The session engine, the bridge, the SPA, and the Pages
proxy are implemented and tested; the QR-login against a real account, the first deploy, the CPU measurement, and the
72 h soak need the owner's `api_id`/`api_hash` and domain/Access setup (see
[Pending owner actions](#pending-owner-actions)).

## Layout

| Path         | What                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `worker/`    | Worker package: `src/index.ts` (Hono entry, token gate, exports the DO) and `src/session/**` (the `SessionEngine`)  |
| `pages/`     | Pages package: Vite + React SPA (`src/`), `wrangler.template.jsonc` with the `API_WORKER` service binding           |
| `functions/` | Pages Functions: `api/[[path]].ts` forwards `/api/*` to the worker through `API_WORKER` (must sit at the repo root) |
| `test/`      | Vitest suite as a workspace package; `test/web/**` is the SPA half, everything else is the worker half              |
| `scripts/`   | `check-god-files.ts` and `prepare-wrangler-config.ts`, copied from `@rexezuge/tooling` (see `AGENTS.md`)            |
| `docs/`      | [`session-engine.md`](docs/session-engine.md): engine architecture, bridge API, dev, spike + 72 h soak runbook      |
| `.github/`   | CI, CD, mirror/backup, version-stamp, upstream-sync workflows and the two composite actions                         |

`wrangler.jsonc` is **materialized to the repo root** by `scripts/prepare-wrangler-config.ts` before dev/deploy — the
templates live in `worker/` and `pages/` and every path inside them is root-relative. `wrangler.jsonc` and the generated
`worker-configuration.d.ts` are gitignored and never committed.

## Requirements

- Node 24 (this machine manages it with Volta; the repo pins `pnpm@11.2.2` via `packageManager`)
- Cloudflare account with Workers + Pages for deploys

## Commands

```bash
pnpm install          # installs deps and generates worker-configuration.d.ts (postinstall → typegen)
pnpm run checks:fast  # typecheck (worker, pages, test, scripts, functions) | lint (eslint --fix) | format:check | god-files
pnpm run test         # vitest run
pnpm run test:coverage
pnpm run build        # builds every package (the SPA)
```

### Local development

```bash
cp .dev.vars.example .dev.vars        # fill in TELEGRAM_API_ID / TELEGRAM_API_HASH and a SPIKE_TOKEN

# Worker on http://localhost:8787 (materializes wrangler.jsonc first):
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler dev

# SPA on http://localhost:5173 — /api is proxied to the worker above:
pnpm --filter @telegram-web-client/pages dev
```

`docs/session-engine.md` documents the engine's two modes (wake and live), the bridge API, the token gate, and the
milestone acceptance checklists.

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

1. Merge; CI on `main` goes green and CD starts.
2. CD deploys the `telegram-web-client` worker and the `telegram-web-client-web` Pages project (both need the
   `CLOUDFLARE_*` secrets from the table above). The worker is deployed with `workers_dev: false` — it deliberately
   has no public URL; the Pages Function is its only caller.
3. Set the runtime secrets once per environment:
   `pnpm exec wrangler secret put TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `SPIKE_TOKEN`.
4. Open the Pages URL: the SPA asks for the session token (the same `SPIKE_TOKEN`), then shows the QR login. Point
   `telegram-web-client.<account>.workers.dev`-style DNS at the project only after Access is configured (below).
5. `pnpm exec wrangler tail` (or the dashboard's live logs) shows a wake every `WAKE_INTERVAL_SECONDS` once the alarm
   is armed.

### Pending owner actions

1. **Telegram credentials** — `api_id`/`api_hash` from <https://my.telegram.org> → "API development tools".
2. **Domain + Access** — attach the production domain to the **Pages** project, issue its certificate, then create a
   Cloudflare Access application in front of it with an allow policy for the owner.
3. **Remove the interim gate** — once Access is live, `pnpm exec wrangler secret delete SPIKE_TOKEN`.
4. **M1 acceptance + 72 h soak** — follow `docs/session-engine.md`; the runbook lists the exact checks and what to
   watch during the soak.

## Where this is going

1. **Session-engine spike** — _implemented; acceptance pending_ (needs the credentials above): MTProto (WSS
   transport) inside the Durable Object, QR login, connect → `getDifference` → persist → disconnect → alarm, with CPU
   per wake measured against the Free-plan limit. The runbook is `docs/session-engine.md`.
2. **72 h soak** — _pending the spike_: 5-minute alarm cadence; watch duration/rows/storage against Free-tier limits.
3. **UI fork** — _bridge done, fork pending_: the minimal first-party SPA already uses the remote-session bridge
   (`POST /api/rpc`, `WS /api/updates`, `GET /api/file`); `telegram-tt` can be dropped in behind the same contract.
4. **API routing** — _implemented_: the Pages Function at repo-root `functions/` proxies `/api/*` over the
   `API_WORKER` service binding, keeping the worker off the public internet.

`AGENTS.md` records the architecture invariants, the workflow/secret table, and the lessons carried over from the
sibling repositories.
