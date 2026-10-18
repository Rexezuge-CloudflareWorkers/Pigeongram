# Session engine

How the `SessionEngine` Durable Object works, how to drive it locally, and how to run the milestone-1/2 acceptance.

## Shape

```
browser ──HTTP──▶ Pages (static + /api/* proxy in functions/) ──service binding──▶ worker (Hono)
                                                                                      │
                                                                        SESSION_ENGINE Durable Object
                                                                                      │
                                                                     SessionEngine (worker/src/session/)
                                                                                      │
                                                                   MTProto over WSS (mtcute + @mtcute/wasm)
```

- One DO instance (`ENGINE_OBJECT_NAME = 'main'`) owns the account. All state is in its SQLite database:
  mtcute's storage (`BaseSqliteStorage`: auth keys, session, peers, dialogs, reference messages) plus two engine
  tables (`engine_wakes`, `engine_meta`).
- The worker is **API-only** and, in production, not publicly reachable: `workers_dev: false`, no route, and the
  Pages project is the only caller (through the `API_WORKER` service binding).
- Locally the SPA talks to the worker directly (`/api` is proxied from 5173 to 8787).

### Two modes

| Mode     | When                                             | What happens                                                                                         |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Wake** | Default; `alarm()` every `WAKE_INTERVAL_SECONDS` | connect → `getDifference` catch-up → record `engine_wakes` row → disconnect → re-arm                 |
| **Live** | At least one `/api/updates` socket is attached   | connect → catch up → stay connected; updates broadcast as they arrive; RPCs ride the same connection |

Leaving live: when the last socket closes, the engine disconnects and re-arms the wake cadence. A failed live
connect broadcasts `{"type":"error"}` to attached sockets and falls back to the wake cadence. An RPC burst on a
_waking_ engine arms a 60 s idle alarm, so a session is not torn down between calls but is also not kept forever.
Account presence is therefore **offline unless a browser tab is open**.

Both modes refuse to touch the network before the account is linked (`phase: "unauthorized"`): an anonymous
client has no DC to talk to, and mtcute's updates loop restarts without backoff when it cannot fetch its initial
state — which would pin the DO's CPU forever. A pre-login wake therefore records a no-op row (so the alarm cadence
stays observable in `/api/stats`) and connects nothing.

`WAKE_INTERVAL_SECONDS` (wrangler var, default `300`, minimum `30`) is the only cadence knob.

## Free-tier posture

The Free plan gives 10 ms CPU per invocation (wall time on waits is not CPU). The design keeps every wake small:

- **No history backfill.** `getDifference` updates and reference messages are persisted; no dialogs/messages are
  fetched into the DO. History and media are served live through the bridge while the session is connected.
- **WASM crypto.** SHA-1/IGE/gzip come from `@mtcute/wasm` (57 KB), imported as a `CompiledWasm` module and
  instantiated synchronously; the JS crypto is only for the random pool and 2FA (`crypto.subtle`).
- **Small bundle.** mtcute core is ~427 KB gzip in the worker bundle; the 3 MiB Free limit has plenty of room.
- **Bounded storage.** The DO's SQLite is the only storage (no D1, no R2). `GET /api/stats` reports
  `databaseBytes` so growth is visible in the soak.

## Bridge API

All routes live under `/api/*` on the worker; the Pages Function forwards them verbatim. Unless noted, responses
are JSON, errors are `{"error": string}` with a 4xx/5xx status, and a misconfigured deployment answers `503` with
the engine's configuration message.

| Route                      | Body / query                            | Returns                                                    |
| -------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| `GET /api/state`           | —                                       | `EngineStateDto` (`phase`, `authorized`, `me`, `qrUrl`, …) |
| `POST /api/login/qr`       | —                                       | `EngineStateDto`; starts (or joins) the QR login           |
| `POST /api/login/phone`    | `{"phone": string}`                     | `EngineStateDto`; sends a login code (phone-number path)   |
| `POST /api/login/code`     | `{"code": string}`                      | `EngineStateDto`; submits the login code                   |
| `POST /api/login/password` | `{"password": string}`                  | `EngineStateDto`; submits the 2FA cloud password           |
| `POST /api/login/cancel`   | —                                       | `EngineStateDto`; aborts an in-flight login                |
| `POST /api/logout`         | —                                       | `{"ok": true}`; logs out, closes updates sockets, re-arms  |
| `POST /api/rpc`            | `{"method": string, "params"?: object}` | method-specific JSON (below)                               |
| `GET /api/updates`         | WebSocket                               | server events (below)                                      |
| `GET /api/file`            | `?chatId=&messageId=`                   | photo bytes (`image/*` served as octet-stream)             |
| `POST /api/wake`           | —                                       | `WakeCountersDto`; runs one wake cycle now                 |
| `GET /api/stats`           | `?days=1..30` (default 7)               | `StatsDto` (`counters`, per-day buckets, `databaseBytes`)  |

`GET /health` lives on the worker, not the engine, and is never gated.

### RPC methods

| Method           | Params                                             | Returns                                   |
| ---------------- | -------------------------------------------------- | ----------------------------------------- |
| `getMe`          | —                                                  | `{me}`                                    |
| `getDialogs`     | `{limit?: 1..200}`                                 | `{dialogs: DialogDto[]}` (pinned first)   |
| `getHistory`     | `{chatId, limit?: 1..100, offsetId?, offsetDate?}` | `{messages: MessageDto[]}` (oldest first) |
| `sendMessage`    | `{chatId, text}`                                   | `{message}`                               |
| `readHistory`    | `{chatId}`                                         | `{}`                                      |
| `searchMessages` | `{chatId, query, limit?, offsetId?}`               | `{messages, nextOffsetId?}`               |

`chatId` is always a **marked** peer id: users positive, basic groups `-id`, channels/supergroups `-100…`.
The client never sends raw MTProto; the engine resolves peers server-side.

### Updates socket protocol

Client → server: `{"type":"hello"}` (attach; engine goes live) and `{"type":"ping"}` (25 s keepalive).
Server → client: `{"type":"ready"}`, `{"type":"pong"}`, `{"type":"error","message":…}`, and
`{"type":"update","update":{"type":"new_message"|"edit_message"|"read", …}}`.

## Local development

```bash
cp .dev.vars.example .dev.vars        # fill in api_id/api_hash and a SPIKE_TOKEN
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler dev                # worker on :8787
pnpm --filter @telegram-web-client/pages dev   # SPA on :5173, /api proxied
```

Smoke checks (no Telegram credentials needed for the first two):

```bash
curl -s localhost:8787/health
curl -s localhost:8787/api/state -H "x-session-token: $SPIKE_TOKEN"   # → phase "unauthorized"
```

With credentials in `.dev.vars`, open the SPA, paste the token, and scan the QR code from Telegram
(Settings → Devices → Link Desktop Device).

Both sign-in paths are available in the SPA: the QR code (primary) and, behind "Use a phone number instead",
the phone-number path (`sendCode` → code → optional 2FA). The phone path exists because a login code is valid
for minutes rather than the QR token's ~30 seconds, and because it needs no camera — Telegram delivers the code
to your own app. `phase` reports the path: `qr`/`scanned` for the QR, `code` while a code is awaited
(`codeType` says how it was delivered, `codeInvalid` after a rejected one).

## Milestone 1 — spike acceptance

1. `pnpm exec wrangler deploy --dry-run` is clean (also verifies the wasm import).
2. Deploy (`wrangler deploy` + secrets), then `GET /health` and `GET /api/state` through the token gate.
3. `POST /api/wake` answers with `totalWakes: 1, failedWakes: 0` and the DO returns to sleep; verify with
   `GET /api/stats` that `avgWakeMs` fits the plan's limits and `lastWakeAt` is recent.
4. QR login completes end-to-end: `phase` walks `qr → scanned → (password) → authorized`, and `me` is populated.
5. A message sent to the account from another device appears in the SPA within a wake interval or immediately while
   a tab is open (live mode); sends and reads round-trip.
6. `wrangler tail` shows no unhandled exceptions during the cycles above.

## Milestone 2 — 72 h soak

After the spike passes, leave the deployment at the default 300 s cadence for 72 hours with a tab closed
(so every cycle is a wake):

- Poll `GET /api/stats?days=30` daily (or keep the SPA open and read the soak numbers); watch
  `counters.failedWakes`, `days[].avgMs`, `days[].updates`, and `databaseBytes`.
- In the Cloudflare dashboard, check the worker's CPU-time metrics and the DO's storage/size metrics against the
  Free plan; confirm no wake exceeds the per-invocation CPU budget.
- The soak's job is to prove the cadence, the storage shape, and the CPU profile — a failed wake must be a
  recorded row (`engine_wakes.ok = 0` with `error`), never a silent stop. The engine re-arms after failures.

## Deploy and gate

```bash
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler deploy
pnpm exec wrangler secret put TELEGRAM_API_ID
pnpm exec wrangler secret put TELEGRAM_API_HASH
pnpm exec wrangler secret put SPIKE_TOKEN       # until Access exists
```

Pending owner actions (one-time):

1. `api_id` / `api_hash` from my.telegram.org (the QR login needs them).
2. Attach the production domain to the **Pages** project, issue the certificate, then put a Cloudflare Access
   application (with an allow policy for the owner) in front of it.
3. Only then remove `SPIKE_TOKEN` (`wrangler secret delete SPIKE_TOKEN`): Access is the gate from that point on,
   and the worker itself is not publicly routable.

## Troubleshooting

| Symptom                                                          | Cause                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/*` → `401 {"code":"gate"}`                                 | `SPIKE_TOKEN` is set and the `x-session-token`/`?token=` value does not match                                                                              |
| `/api/*` → `503` "TELEGRAM_API_ID…"                              | Secrets are missing on the deployment (the engine reports the configuration error)                                                                         |
| `/api/*` → `503` "Session engine unreachable"                    | The `SESSION_ENGINE` binding is missing (e.g. a root `wrangler.jsonc` without the DO)                                                                      |
| `phase: "error"` after scanning the QR                           | Wrong api_id/api_hash, or the login was cancelled; `POST /api/login/cancel` then retry                                                                     |
| Scanning the QR fails with a generic client-side error           | The code was older than its ~30 s life (the SPA hides dying codes and counts down); prefer the phone-number path if the camera lag keeps losing the race   |
| `phase: "error"` on the phone path                               | The number or code was rejected; the phase message names it (`PHONE_NUMBER_INVALID`, `PHONE_CODE_EXPIRED`, `FLOOD_WAIT_…`)                                 |
| Updates never arrive while a tab is open                         | The socket failed live connect: look for a `{"type":"error"}` frame and `wrangler tail`                                                                    |
| `getHistory` answers "chatId must be a marked Telegram peer id"  | The client sent a raw/unmarked id; channel ids must be `-100…`                                                                                             |
| Logs repeat "Not connected to any DC" in a tight loop            | The updates loop was started on an unsigned-in or disconnected client; the engine guards against both, so this means a stale build — redeploy and re-login |
| One `[mtcute:updates] … Session is reset` warning per disconnect | The update loop's in-flight `getDifference` lands on the teardown every wake performs; expected, and the wake itself still reports `ok`                    |
