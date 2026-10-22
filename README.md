# Telegram Web Client

An always-online Telegram web client hosted on Cloudflare:

- **`worker/`** — the backend. A Hono API and a Durable Object (`SessionEngine`) that is the single home of one
  Telegram account's MTProto session: it wakes on an alarm every few minutes, connects to Telegram over WSS, replays
  `getDifference`, persists to DO SQLite, disconnects, and re-arms its own alarm. While a browser tab is attached it
  holds the session live and pushes updates. See [`docs/session-engine.md`](docs/session-engine.md).
- **`pages/`** — the frontend. A Vite + React + Tailwind SPA with a four-state home: a public intro page, the offline
  screen when there is no network, the Telegram QR login
  once Cloudflare Access admits the browser, and the chat list once Telegram is linked (threads, live updates, online
  presence, pathname deep links). Sends are optimistic: a composed message or file appears in the thread and the chat
  list at once, and the composer stays usable while it is on its way. Files reach a chat from the attach button or
  from a paste into the message box; both go through the same review step. It installs as a progressive web app and
  boots offline into its shell (see [`docs/pwa.md`](docs/pwa.md)). It talks to the worker through the bridge
  and will grow into a fork of
  [`telegram-tt`](https://github.com/PBhadoo/telegram-tt) wired to the same bridge.
- **`functions/`** — the Pages Functions proxying `/api/*` (public health) and `/user/*` (Access-gated user API) to
  the worker over the `API_WORKER` service binding, so the worker itself never has to be reachable from the internet.

**Status: milestone 1 code complete, acceptance pending.** The session engine, the bridge, the SPA, the Pages
proxy, and the worker's Cloudflare Access JWT verification are implemented and tested; the QR-login against a real
account, the first deploy, the CPU measurement, and the 72 h soak need the owner's `api_id`/`api_hash` and the
deployment's Access configuration (see [Pending owner actions](#pending-owner-actions)).

## Layout

| Path         | What                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker/`    | Worker package: `src/index.ts` (Hono entry, Access JWT gate, exports the DO) and `src/session/**` (the `SessionEngine`)                                                                      |
| `pages/`     | Pages package: Vite + React + Tailwind SPA (`src/`), `wrangler.template.jsonc` with the `API_WORKER` service binding                                                                         |
| `functions/` | Pages Functions: `api/[[path]].ts` forwards the public `/api/*` plane and `user/[[path]].ts` the Access-gated `/user/*` plane to the worker through `API_WORKER` (must sit at the repo root) |
| `test/`      | Vitest suite as a workspace package; `test/web/**` is the SPA half, everything else is the worker half                                                                                       |
| `scripts/`   | `check-god-files.ts` and `prepare-wrangler-config.ts`, copied from `@rexezuge/tooling` (see `AGENTS.md`)                                                                                     |
| `docs/`      | [`session-engine.md`](docs/session-engine.md): engine architecture, bridge API, dev, spike + 72 h soak runbook; [`pwa.md`](docs/pwa.md): the service worker's rules and the install build    |
| `.github/`   | CI, CD, mirror/backup, version-stamp, upstream-sync workflows and the two composite actions                                                                                                  |

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
cp .dev.vars.example .dev.vars        # fill in TELEGRAM_API_ID / TELEGRAM_API_HASH

# Worker on http://localhost:8787 (materializes wrangler.jsonc first):
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler dev

# SPA on http://localhost:5173 — /api and /user are proxied to the worker above:
pnpm --filter @telegram-web-client/pages dev
```

Local development does not pass through Cloudflare Access: the example `.dev.vars` sets
`ACCESS_DEV_BYPASS="true"` (with `ENVIRONMENT="development"`), which the worker honors only outside production. Never
set the bypass on a deployment.

`docs/session-engine.md` documents the engine's two modes (wake and live), the bridge API, the Access JWT gate, and the
milestone acceptance checklists.

## The progressive web app

The SPA installs as an app and boots without a network:

- **Installable.** The build writes a web app manifest and the icons (the paper-plane mark, drawn from the same
  geometry as the tab favicon) into the bundle. Chromium offers the install from the address bar, and the account menu
  offers it too when the browser raises the prompt. iOS reads its touch icon from the document.
- **Offline shell.** A service worker precaches the build's own files, so the app boots with no network and shows an
  offline screen; chats, media and history are still read live, by design.
- **The account plane is never cached.** `/user/*` and `/api/*` always go to the network. `/user/login` in particular
  has to reach Cloudflare Access, or the sign-in round-trip breaks.

`docs/pwa.md` is the runbook: the worker's rules, how the worker and the icons are built, and how to verify an
install. The worker is not registered in development — a worker in the dev server would serve a stale shell over Vite's
own modules.

## CI and deployment

- **Continuous Integration** (`.github/workflows/continuous-integration.yml`) runs on PRs, pushes to `main`, and
  upstream-sync dispatches. One job per gate: **Typecheck**, **Lint**, **Format**, **God Files**, **Unit Tests**
  (coverage artifact), **Build Web App**, plus the two tail jobs (Dependabot auto-merge, upstream-sync deployment
  dispatch).
- **Continuous Deployment** (`.github/workflows/continuous-deployment.yml`) runs after CI succeeds on `main`, with
  `deploy-worker` and `deploy-pages` in parallel. The worker deploy materializes `wrangler.jsonc`, runs
  `wrangler deploy --dry-run` as a gate, then deploys; the Pages deploy builds the SPA, creates the Pages project if
  absent, and deploys.
- **Backup Main Branch** (`.github/workflows/backup-main.yml`) mirrors `main` to Azure DevOps and/or GitLab after every
  push and on a monthly schedule. Both destinations are opt-in by secret; with neither configured the workflow skips
  green.

There is deliberately no database-backup workflow: the family's `backup-d1.yml` exports a D1 database, which this repo
does not use. The session engine's storage is the Durable Object's SQLite, which Cloudflare streams to object storage
with point-in-time recovery, and it holds the mtcute session, the update state and small caches — losing it costs a QR
re-login, not history.

### Repository settings (set before merging the first scaffold PR)

| Kind                | Name                                                                     | Purpose                                                  |
| ------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| Secret              | `CLOUDFLARE_API_TOKEN`                                                   | Workers Scripts:Edit + Pages:Edit, scoped to the account |
| Secret              | `CLOUDFLARE_ACCOUNT_ID`                                                  | Cloudflare account id                                    |
| Secret (optional)   | `BACKUP_REPO_AZURE_DEVOPS_SSH_KEY` / `BACKUP_REPO_AZURE_DEVOPS_REPO_URL` | Mirrors `main` to Azure DevOps (backup workflow)         |
| Secret (optional)   | `BACKUP_REPO_GITLAB_SSH_KEY` / `BACKUP_REPO_GITLAB_REPO_URL`             | Mirrors `main` to GitLab (backup workflow)               |
| Variable (optional) | `CLOUDFLARE_PAGES_PROJECT_NAME`                                          | Overrides the default `telegram-web-client-web`          |
| Variable (optional) | `WRANGLER_JSONC` / `WRANGLER_PATCH_JSON` / `WRANGLER_VARS_PATCH_JSON`    | Per-environment wrangler overrides                       |

The worker's `/user/*` routes verify Cloudflare Access, so a real deployment must supply both halves of the verifier
through `WRANGLER_VARS_PATCH_JSON` (or the dashboard's vars):

```json
{ "TEAM_DOMAIN": "https://<team>.cloudflareaccess.com", "POLICY_AUD": "<application-aud-tag>" }
```

`TEAM_DOMAIN` is the Zero Trust team domain (**Zero Trust → Settings**), and `POLICY_AUD` is the application's
**Application Audience (AUD) Tag** (**Zero Trust → Access controls → Applications →** the Pages application **→
Additional settings**). The values are public configuration, not secrets. When they are missing, `/user/*` answers
`503 {"code":"access_config"}` rather than serving the session unauthenticated. `GET /api/health` stays public.
Account routes moved from `/api/*` to `/user/*`; an old `/api/state`, `/api/rpc`, or media URL now returns `404`.

Also: enable **Allow auto-merge** (the Dependabot job depends on it), and after the first CI run set branch protection
on `main` with required checks **Typecheck**, **Lint**, **Format**, **God Files**, **Unit Tests**, **Build Web App**.

### First-deploy verification

1. Merge; CI on `main` goes green and CD starts.
2. CD deploys the `telegram-web-client` worker and the `telegram-web-client-web` Pages project (both need the
   `CLOUDFLARE_*` secrets from the table above). The worker is deployed with `workers_dev: false` — it deliberately
   has no public URL; the Pages Function is its only caller.
3. Set the runtime secrets once per environment:
   `pnpm exec wrangler secret put TELEGRAM_API_ID`, `TELEGRAM_API_HASH`. Set the Access verifier vars
   (`TEAM_DOMAIN`, `POLICY_AUD`) before the worker deploy, per the repository-settings note above.
4. Open the Pages URL. Anonymous visitors see the public intro; **Sign in with Cloudflare Access** navigates to
   `/user/login`, Access runs its login flow, and the worker sends the browser back to the path it came from (the SPA
   root by default). Once Access is through, the SPA shows the Telegram QR login while the account is not linked, then
   the chat list. The worker verifies the Access assertion on every `/user/*` request; `GET /api/health` is the
   public, ungated endpoint. The Access application must be **path-scoped to `/user*`** (including `/user/login` and
   `/user/`), so `/`, the SPA assets, and `/api/*` stay reachable without a login.
5. `pnpm exec wrangler tail` (or the dashboard's live logs) shows a wake every `WAKE_INTERVAL_SECONDS` once the alarm
   is armed.

### Pending owner actions

1. **Telegram credentials** — `api_id`/`api_hash` from <https://my.telegram.org> → "API development tools".
2. **Domain + Access** — attach the production domain to the **Pages** project, issue its certificate, then create a
   Cloudflare Access application in front of it with an allow policy for the owner. It must be a self-hosted
   application on the public hostname, not an Access application targeting the worker: Worker-destination Access
   rejects WebSocket upgrades. Scope its path to `/user*` so the public intro at `/`, the SPA assets, and
   `GET /api/health` stay reachable while the user API and the Access entry point remain gated. Note its AUD tag and
   the team domain, then set `TEAM_DOMAIN`/`POLICY_AUD` as above.
3. **M1 acceptance + 72 h soak** — follow `docs/session-engine.md`; the runbook lists the exact checks and what to
   watch during the soak.

## Where this is going

1. **Session-engine spike** — _implemented; acceptance pending_ (needs the credentials above): MTProto (WSS
   transport) inside the Durable Object, QR login, connect → `getDifference` → persist → disconnect → alarm, with CPU
   per wake measured against the Free-plan limit. The runbook is `docs/session-engine.md`.
2. **72 h soak** — _pending the spike_: 5-minute alarm cadence; watch duration/rows/storage against Free-tier limits.
3. **UI fork** — _bridge done, fork pending_: the minimal first-party SPA already uses the remote-session bridge
   (`POST /user/rpc`, `WS /user/updates`, media routes `GET /user/file`, `GET /user/avatar`, `POST /user/upload`,
   `POST /user/upload-group`);
   `telegram-tt` can be dropped in behind the same contract.
4. **API routing** — _implemented_: the Pages Functions at repo-root `functions/` proxy `/api/*` (public) and
   `/user/*` (Access-gated) over the `API_WORKER` service binding, keeping the worker off the public internet.

`AGENTS.md` records the architecture invariants, the workflow/secret table, and the lessons carried over from the
sibling repositories.
