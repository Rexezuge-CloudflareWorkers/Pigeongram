# AGENTS.md

Index for agents and humans working in this repository. Read `README.md` for the product overview and commands; this
file records the architecture, the load-bearing invariants, and the house conventions.

## Overview

**Telegram-Web-Client** is an always-online Telegram web client on Cloudflare. The worker (`worker/`) is the backend —
a Hono API and a Durable Object (`SessionEngine`) that owns one Telegram account's MTProto session: a 5-minute alarm
wakes it to connect, replay `getDifference`, persist to DO SQLite and disconnect (the always-reachable baseline), and
while a browser socket is attached it holds the session live and pushes updates. The Pages app (`pages/`) is the Vite +
React front end (public intro, QR login, chat list, threads), and the Pages Functions (`functions/`) proxy `/api/*` (public health)
and `/user/*` (Access-gated user API) to the worker over a service binding so the worker never faces the internet.
One account, single user, Free-tier-first: the 10 ms CPU per invocation and the 100,000 rows written/day limits are the
constraints the session engine is measured against. `docs/session-engine.md` is the engine's runbook.

## Commands

House toolchain: Node 24 and pnpm 11.2.2 are Volta-managed (`~/.customrc` is sourced by the login shell; `volta run`
honours the `packageManager` pin). Every command below also works as `volta run pnpm …`.

| Command                           | What it does                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                    | Installs the workspace and runs `postinstall` → `pnpm run typegen`                                                |
| `pnpm run typegen`                | Regenerates `worker-configuration.d.ts` from `worker/wrangler.template.jsonc`                                     |
| `pnpm run typecheck`              | `pnpm -r typecheck` (worker, pages, test) + `typecheck:scripts` + `typecheck:functions` + `typecheck:pages-build` |
| `pnpm run lint`                   | `eslint --fix --quiet .` under `--max-old-space-size=6144`                                                        |
| `pnpm run format:check`           | `prettier --check .` (read-only; the CI formatting gate)                                                          |
| `pnpm run check:god-files`        | 300-line warn / 400-line hard gate (`--fail-on-hard`), tests and `scripts/` exempt                                |
| `pnpm run test` / `test:coverage` | Vitest, both projects (worker under `node`, SPA under jsdom)                                                      |
| `pnpm run checks:fast`            | typecheck + lint + format:check + god-files                                                                       |
| `pnpm run checks`                 | `checks:fast` + `test:coverage`                                                                                   |

Local dev: `cp .dev.vars.example .dev.vars` (secrets are gitignored), materialize the config
(`pnpm exec tsx scripts/prepare-wrangler-config.ts`), then `pnpm exec wrangler dev` (worker, port 8787) and
`pnpm --filter @telegram-web-client/pages dev` (SPA, port 5173, `/api` and `/user` proxied to the worker).

## Architecture & invariants

### Layout

- `worker/` — the API worker. `src/index.ts` is the Hono entry (public `/api/health`, the Cloudflare Access JWT gate on
  `/user/*`, forwarding to the DO) and re-exports `SessionEngine`; wrangler discovers the DO class through that export.
  `src/access.ts` verifies the Access assertion with `jose` (signature, issuer, AUD, expiry; JWKS cached per team
  domain). `src/session/` holds the engine (`engine.ts`), its bridge modules (`rpc`, `dto`, `params`, `updates`,
  `media`, `comments`, `stats`, `login-flow`, `driver`, `http`, `socket-hub`, `unread-albums`, `call-{rpc,dto,params,
protocol,registry}`) and the mtcute integration
  (`mtproto/{client,crypto,transport,sqlite,platform}.ts`). The bridge contract is `src/types.ts` (the DTOs) plus
  `src/rpc-types.ts` (the RPC method shapes), both mirrored in the SPA; the calls' half is `src/call-types.ts`
  (the call DTOs and the `call.*` method shapes), mirrored as `pages/src/call-types.ts`. `wrangler.template.jsonc`
  declares the DO
  binding (`SESSION_ENGINE`), the `v1` SQLite migration, `workers_dev: false` and `WAKE_INTERVAL_SECONDS`; the
  deployment-specific `TEAM_DOMAIN`/`POLICY_AUD` come from `WRANGLER_VARS_PATCH_JSON` and are declared in
  `src/env.d.ts`.
- `pages/` — the SPA. `wrangler.template.jsonc` has the `pages_build_output_dir` and the `API_WORKER` service binding
  (consumed by `functions/`); `src/` is the React app (`api.ts` is the bridge client, `state.ts` the chat-list
  reducers, `useDialogs.ts` the chat-list controller — the main list and the archive in one list, the live updates
  and the archive move — `useThread.ts`/`useComments.ts` the thread controllers — open, scroll-driven read receipts,
  send/attach/react and forward with a writable-destination picker — `outbox.ts`/`useOutbox.ts` the optimistic send
  layer, `thread-window.ts` the first-window read
  (newest messages, or a window around a linked post), `reading.ts` the
  unread-position logic they share, `components/` the screens). The calls live in `src/calls/` (`dh.ts` the
  browser-side Diffie-Hellman, `crypto.ts` the packet envelope, `exchange.ts` the key establishment, `peer.ts` the
  WebRTC peer and the signalling channel, `controller.ts` the call state machine, `session.ts` its reducer,
  `host.tsx` the hook that joins the calls to the updates socket, `signalling.ts` the payload format, `webrtc.ts` the
  peer connection, `ringtone.ts` the synthesised ringtone), with the overlay in `components/CallOverlay.tsx`. The home
  page has four states: `LandingPage.tsx` is
  the public intro, `OfflineScreen.tsx` the no-network screen, `LoginScreen.tsx` the Telegram QR login, and
  `CheckingAccess.tsx` the Access probe's first paint — `components/HomeScreen.tsx` picks among them from
  `useLoginFlow`'s `access: 'checking' | 'anonymous' | 'authenticated' | 'offline'`, because `App.tsx` is already at
  the god-file limit. **UI chrome uses one icon set**: `pages/src/components/Icon.tsx` is the only place an interface
  icon is drawn — a filled 24-unit Material set, `currentColor`, `data-icon` for tests, decorative unless given a
  `label`. A new affordance adds an `IconName`, never another inline `<svg>`, a font glyph or an emoji; emoji are content
  (Telegram reactions and message text), not chrome. A successful
  `/user/state` probe means Access is through, and `state.authorized` then picks QR vs chat list. The intro's sign-in
  link is `/user/login`; the worker redirects it back into the SPA, carrying a validated same-origin `next` so a
  bookmarked chat link survives the Access round-trip. Navigation is pathname-based: `routes.ts` is the pure
  route grammar (`/`, `/archived`, `/chat/:id`, `/chat/:id/post/:id`, `/chat/:id/post/:id/comments`), `useRouter.ts`
  owns `location`/`history`/`popstate`, `useChatNavigation.ts` applies routes to the thread and comments controllers,
  and `useMediaViewer.ts` makes the media viewer a history layer on the same URL. `links.ts` is the Telegram link grammar
  (t.me URLs and `tg://` deep links normalized to one target) plus the native-app handoff, `telegram-links.tsx` the
  context that routes link clicks from message bodies (`components/MessageText.tsx`) — known chats open in the thread,
  everything else Telegram goes to the installed app — and `richtext.tsx` the formatting/entity renderer. Styling is
  Tailwind v4 through `@tailwindcss/vite`: `src/styles/tailwind.css` imports full Tailwind (preflight included) and
  layers the existing stylesheets under `components`, so legacy rules sit above preflight but below utilities. New UI
  should use utilities; extend a legacy sheet only for a genuinely shared rule. The installable app sits beside it:
  `sw/` is the service worker (its own tsconfig, the WebWorker lib), `build/pwa/` is the build-time half (the icons,
  the manifest, and the local Vite plugin that writes them), `src/pwa/` is the runtime half (the registration and the
  install prompt), and `public/_headers` carries the cache headers Pages serves with the static assets.
- `functions/` — Pages Functions, always at the **repo root** (not under `pages/`), because the config wrangler reads
  for them is the materialized root `wrangler.jsonc`. `api/[[path]].ts` and `user/[[path]].ts` are pass-throughs to
  `env.API_WORKER`; they must not import workspace packages (Pages bundles them separately).
- `docs/` — `session-engine.md`: engine architecture, bridge API table, local dev, M1 spike + M2 soak runbooks,
  troubleshooting. `pwa.md`: the service worker's rules, the install build, the offline state, and how to verify it.
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
- **The SPA relies on the Pages default fallback for pathname routes.** There is deliberately no top-level `404.html`:
  Cloudflare Pages then serves `index.html` for `/chat/...` on refresh and direct links, and Vite's dev server does the
  same. Do not add a `404.html` or a catch-all that would turn a deep-linked thread into a 404. A first visit seeds the
  list (and, for comments, the matching chat) behind the URL entry so browser back stays in the app; every entry carries
  `{ app: 'telegram-web-client', depth, layer?: 'viewer' }` in `history.state`, and the viewer is a same-URL layer so back
  closes it before leaving the thread.
- **The service worker never caches the account plane.** The worker is registered at the root (`/sw.js`, scope `/`), so
  it sees every request the page makes, and it answers the API plane from the network only: `/user/*` carries the
  account's data and the Cloudflare Access session, and a cached response would put one account's chats where the next
  reader could reach them. The rule lives in `pages/sw/routes.ts` as a pure function and is asserted by
  `test/pwa/routes.test.ts`. The navigation case matters most: `/user/login` is where Access runs its login flow, so a
  navigation to it must reach the edge — answering it with the precached shell would swallow the redirect and the
  sign-in would never happen. Every other navigation falls back to the precached `index.html`, which is the document
  Pages serves for a pathname route anyway.
- **The worker does not call `skipWaiting`.** A new build's worker waits until the last client of the old one is gone,
  so the update lands on the next fresh load. Skipping the wait would purge the old hashed assets while an open tab
  still runs the old JavaScript.
- **The worker is not registered in development.** `import.meta.env.PROD` gates the registration and
  `devOptions.enabled` is off: a worker in the dev server would serve a stale shell over Vite's own modules and break
  hot reloading. The dev server still serves the manifest and the icons, so the document's manifest link is not a 404.
- **Offline is a state of its own, not a sign-out.** The Access probe and a dead network both fail as a `TypeError`
  from `fetch`, so the probe asks the public `/api/health` endpoint which of the two it is: it answers when the network
  is up (the reader is outside the front door) and fails when it is not (the app shows `OfflineScreen` and waits for the
  browser's `online` event).
- **The signed-in shell fits above the keyboard.** `useAppHeight` writes the smaller of
  `document.documentElement.clientHeight` and `window.visualViewport.height` into `--app-height`, and `.app` consumes
  it as a **`max-height` cap** over a plain `height: 100%` — so the value can only shorten the shell. Folding the two
  back into one `height` lets the cap sit a fraction of a pixel above the viewport (the hook floors rather than rounds,
  but `clientHeight` is itself rounded), and Chrome draws a scrollbar for that much overflow. Chromium's
  `interactive-widget=resizes-content` shrinks the layout viewport, while an overlay keyboard shrinks only the visual
  one; taking the minimum keeps the composer above a keyboard that one of them lags in reporting. The hook observes
  both the root (`ResizeObserver`) and the visual viewport, and `settleToBottom` re-pins both scroll views on the
  resulting host resize. Don't replace this with a fixed `100%`/`dvh` height.
- **Sends are optimistic, but the thread and the dialogs stay server truth.** `pages/src/outbox.ts` (the entry shape and
  the chat-list overlay) and `pages/src/useOutbox.ts` (the bridge round trip) keep pending sends in their own layer: a
  `PendingMessage` renders beside the loaded messages (`components/PendingMessageRow.tsx`) and is folded over the
  dialogs for the sidebar preview only. Never inject a synthetic message into `ChatThread.messages` or
  `DialogDto.lastMessage`: message ids, read watermarks, unread counts and reply lookups are read from the server, and a
  pending row with a negative id would poison all of them. Dropping the entry is the whole rollback. Text sends are
  chained per chat so rapid messages keep their order, uploads run independently so a large file never delays the next
  text, and a failed send stays as a "Not sent" bubble with Retry/Discard. A retry reuses the entry's `randomId`, so
  Telegram drops the duplicate if the first attempt actually landed — the engine validates that id like any other
  parameter (`worker/src/session/params.ts`, and `worker/src/session/upload-spec.ts` for the upload query). An album
  (`POST /user/upload-group`) has no client-chosen id: Telegram picks the group's, so a retried album is a new album.
- **The worker is not publicly routable.** `workers_dev: false` and no route: the only caller is the Pages Functions
  (`API_WORKER` service binding). The API surface is split by prefix: `/api/*` is public and carries only
  `GET /api/health`; everything account-scoped lives under `/user/*`, where every request verifies the Cloudflare
  Access assertion (`Cf-Access-Jwt-Assertion`) in `worker/src/access.ts` — RS256 signature against
  `${TEAM_DOMAIN}/cdn-cgi/access/certs`, issuer, `POLICY_AUD`, and expiry — before forwarding to the DO. The Access
  application's policy is the allowlist; the worker deliberately does not check the email. `/api/health` is public and
  carries no account data. When `TEAM_DOMAIN`/`POLICY_AUD` are absent or malformed, `/user/*` answers
  `503 {"code":"access_config"}` — never an unauthenticated fallback. At the edge, the Access application must be
  **path-scoped to `/user*`**: `/`, the SPA assets, and `/api/health` stay public, while the account API and the
  `/user/login` entry point are gated. A host-wide application with only `/api/*` bypassed would also gate the public
  intro. `GET /user/login` redirects to a validated same-origin `next` path (default `/`), so Access's return trip
  lands back in the SPA instead of on the engine. The Access app must be a **self-hosted** app on the Pages hostname,
  not a Worker-destination app: the latter
  rejects WebSocket upgrades. `ACCESS_DEV_BYPASS` skips verification only while `ENVIRONMENT !== "production"` and
  belongs in `.dev.vars` only. Do not add an `/api/*` catch-all that forwards to the DO: the public plane must never
  reach the account API.
- **Storage is mtcute's storage over the DO's SQLite, but only mtcute's session state is durable.** `session/mtproto/sqlite.ts`
  adapts `ctx.storage.sql` to `ISqliteDatabase` (`transactionSync` backs mtcute's `driver.save()`); `key_value` (the
  update cursor, DC options and salts) and `auth_keys` stay in SQLite, while the peer and reference-message caches are
  memory-only. Engine-owned tables are prefixed `engine_`. There is no history backfill — session, update state and small
  caches only; history and media are fetched live through the bridge. The engine's own tables are `engine_wakes` (the
  wake log), `engine_meta` (the signed-in user's DTO), `engine_avatars` (the profile-photo bytes, keyed by the version
  token the engine resolved), `engine_unread_albums` (the unread album members per chat) and `engine_unread_state` (the
  album ledger's reconciliation marker).
- **The Free plan's write budget is 100,000 rows/day, account-wide, and it is a first-class constraint.** The reset is
  00:00 UTC; `setAlarm()` is one row written, deletes count, and an indexed row costs one write per index. mtcute
  refills its peer cache on **every** response (`peers.updatePeersFrom`), so persisting peers would rewrite every peer
  on each read — the reason `createTelegramStorage` backs `peers`/`refMessages` with mtcute's memory repositories and
  keeps only `kv`/`authKeys` durable. `SessionLifecycle.arm` reads `getAlarm()` and skips a redundant `setAlarm`;
  `ensureArmed` on every request repairs a cadence a rejected write left behind; and the wake log, avatar cache and
  album ledger writes are best-effort, so reads and the update stream keep working when the quota is exhausted. Never
  add a write to a read path, and never "clean up" tables while the budget is spent — deleting rows is itself a write.
- **An album counts as one unread message.** Telegram counts every album member as a message, so an album of ten files
  arrives as an unread count of ten. The badge counts the album once, and the **album ledger**
  (`worker/src/session/unread-albums.ts`) is what makes the two agree: it records the album members the update stream
  delivered, drops the ones a read covered, and the surplus (the members beyond the first of their album) is
  subtracted from the count `getDialogs` serves and from the `unread` a `read` update carries. The ledger lives in the
  DO's SQLite because the engine sleeps between its wakes, and it learns from the update stream, so it costs no
  Telegram traffic. A fresh sign-in starts with an empty ledger, so the first `getDialogs` reconciles it: it reads the
  unread range of every chat with unread messages, once per sign-in. On the SPA side, `DialogMessageDto.groupedId`
  says that a new message continues the album the chat list already counted, and the optimistic read-through
  subtracts albums rather than messages (`pages/src/groups.ts`).
- **One request is one Durable Object event, and the DO hands out one event at a time.** Two bridge calls therefore cost
  two round trips in sequence, whatever the browser does — and each one costs a Telegram round trip on the far side.
  Inside one event mtcute's transport multiplexes, so the lever is **fewer events and more concurrency inside each
  event**. `POST /user/rpc`'s `batch` method is that mechanism: it runs several **read-only** methods in one request,
  concurrently, over the one connection. The whitelist is deliberate — a batch runs its calls concurrently, so a write
  would have no defined completion order, and `readHistory` is excluded because it moves the account's read watermark.
  Per-call failures are reported per call, so one broken read never takes the reads beside it down. When a screen needs
  several reads, read them together in one batch (`pages/src/api.ts`: `fetchBootstrap`, `fetchChatScreen`) rather than
  chaining requests — a chained pair is exactly the waterfall the batch exists to remove.
- **The archive is a peer folder, and a read of its own.** Telegram keeps the archived chats in the peer folder with
  the id `1`; every other chat is in folder `0`. `getDialogs` reads the chat list without the `archived` flag
  (`folder_id: 0`) and the archive with it (`folder_id: 1`), and `setArchived` moves a chat between the two through
  `folders.editPeerFolders` — the API the official clients use for the archive. The two reads stay apart on purpose: one
  limit over both would cost the chat list the chats the archive holds, and the archive is a screen the reader asks
  for, not one every list load pays for. On the SPA side the archive is a screen of its own (`/archived`, reached from
  the account popup), and the chat list and the archive live in **one** list (`pages/src/useDialogs.ts`), so every
  lookup of a chat — the router, the thread, the read receipts, the forward picker — finds it in the same place. A chat
  opened from the archive keeps the archive list in the sidebar; bringing the open chat back out of the archive hands
  the sidebar back to the chat list, where the chat now lives.
- **The profile popup is a self-contained overlay, not a history layer.** The nav bar of the open chat opens the
  peer's profile — from its picture, from its name, or from the ⋮ menu's "View Profile" — and the popup closes on
  Escape, a backdrop press or its close button. It is deliberately **not** a `history.state` layer (only the media
  viewer is), so Back leaves the thread, as it does for the forward picker. The profile is read on demand
  (`getProfile`, a read-only method on the batch whitelist) rather than with the chat screen: the reader asks for it
  by opening it, and a thread open would otherwise pay for a read nobody looks at. The popup lives in the thread header
  (`pages/src/components/ThreadHeader.tsx`), so `App.tsx` does not grow.
- **A min peer in mtcute's cache turns a valid chat into `PEER_ID_INVALID`.** Telegram's `min` user/channel carries a
  reduced access hash that only works inside an `inputPeer*FromMessage`, and mtcute's in-memory peer cache hands a
  cached peer back from `storage.peers.getById` without the `isMin` check its SQLite branch has
  (`@mtcute/core@0.32.5`, `highlevel/storage/service/peers.js`), so `resolvePeer` can pass a min hash to a regular call.
  A chat that is a dialog — a full peer in storage — starts failing that way after a min copy of it arrives from a
  group's or channel's message list, which is why the official app still opens it and a reload sometimes does.
  `session/peers.ts` is the guard: `withPeerRetry` wraps every peer-addressed bridge call (the batch's per-call dispatch,
  `driver.rpc`, media streams, uploads) and retries **once** on `PEER_ID_INVALID`/`CHANNEL_INVALID`/`USER_ID_INVALID`,
  after re-storing the full entity mtcute already holds when the cached input hash differs from it, or refreshing through
  `resolvePeer(id, true)` when there is no full entity. A rejected peer was never acted on, so the retry is safe for
  writes too. Do not try to solve this by upgrading mtcute: 0.32.6 has the same cache.
- **The replay of the missed updates runs outside the input gate.** `session/lifecycle.ts` owns the wake and live modes;
  `startLive` connects and then hands the `getDifference` catch-up to `state.waitUntil`, because it is the longest event
  in the system and holding the gate for it queued every bridge call behind it. The engine's storage warms up in
  `blockConcurrencyWhile` in the constructor, so the migrations are not on the first request's critical path.
- **Media routes are gated too.** `<img>`/`<video>`/`<audio>` cannot set headers, so they rely on the same-origin
  Access session cookie the browser sends with every request; Access forwards the assertion for the worker to verify.
  There is no token query parameter. `POST /user/upload` takes the file as the raw request body,
  streams it straight into mtcute's upload pool, and is capped by `UPLOAD_MAX_BYTES` (default 100 MB) — that var is
  also the upload-CPU affordability knob. The upload query is validated a second time in the outer worker (same
  parser, `worker/src/index.ts`): workerd reads a request stream after its response when a Durable Object answers
  without consuming the body (cloudflare/workerd#918), so malformed and oversized uploads must never reach it.
- **Albums are one request body, not many.** `POST /user/upload-group` carries 2–10 files concatenated in the order
  the `manifest` query parameter (base64url JSON) declares, and `session/upload.ts` splits that one body back into the
  exact byte ranges (`UploadBodySplitter`) before mtcute's `sendMediaGroup` uploads them in order. The parser
  (`session/upload-spec.ts`) is shared by the engine and the edge, and it enforces the album rules: 2–10 items, one
  media class (photos/videos/GIFs together, documents together), and a total within `UPLOAD_MAX_BYTES`. The split
  streams use `highWaterMark: 0` on purpose — with the default of 1, Web Streams pulls every part at construction, so
  the later files would claim the shared reader before the earlier ones. The composer's upload dialog
  (`pages/src/components/UploadDialog.tsx`) is the review step: it caps the selection at 10, offers "Group Items"
  (checked by default when the selection can group) and sends ungrouped files one by one. Its thumbnail column only
  previews raster images (`previewMime` in `pages/src/upload.ts`, which keeps SVG out), and the preview blob is built
  with that MIME type, so the object URL behind it can never be read as a document. A paste into the composer opens
  the same review step with the pasted files as the selection (`pages/src/clipboard.ts` reads the clipboard): the
  draft rides along as the caption, exactly as it does for the file picker. Only a clipboard without text is taken
  over — a cell copied from a spreadsheet arrives as text _and_ an image of the cell, and there the text is what the
  user meant to paste, so the browser keeps it.
- **Media ranges are cut in the engine, never passed to mtcute as `limit`.** `session/media-stream.ts` streams a byte
  window over `downloadAsIterable` — a 1 MB-block-aligned offset, dropped prefix, local tail cut, and `throttle`
  backpressure so one chunk is buffered — because mtcute's `limit` accepts only the whole file size (or a ≤1 MB
  divisor) and rejects browser ranges with `MtArgumentError` on the first pull, i.e. after the `206` headers are
  already sent; that is what broke `<video>` after its first buffered seconds and Safari's `bytes=0-1` probe. The
  offset must be 1 MB-block-aligned, not merely the 4 KB Telegram documents: mtcute fetches 128 KB–1 MB parts without
  `precise`, and a part that straddles a 1 MB boundary is rejected with `LIMIT_INVALID`, which is how deep seeks into
  large videos broke next.
- **Sockets use the hibernation API**, so the DO can sleep while a tab is attached; the wire protocol lives in
  `session/socket-hub.ts`. `WebSocketPair` only exists under workerd, which is why the `/user/updates` accept path has no
  unit test — it is covered by the local smoke test. The socket's `hello` answers `ready` and then goes live; the
  browser's **first** `ready` follows the boot's own read, so it does not read the chat list again — only a reconnect
  does, because the list may be stale then.
- **The wasm crypto module is a static import** (`@mtcute/wasm/mtcute.wasm`, instantiated with `initSync`); wrangler's
  default `CompiledWasm` rule bundles it and `wrangler deploy --dry-run` is the check. If a wake's startup CPU ever gets
  tight, move the import behind a dynamic import rather than touching mtcute.
- **A call's key exchange runs in the page, never in the worker.** A 2048-bit modular exponentiation costs ~29 ms of
  CPU and the caller's side needs two of them — 5.7× the Free plan's 10 ms per invocation. The worker only reads
  `messages.getDhConfig` and hands `p`/`g` down; the browser does the arithmetic (`pages/src/calls/dh.ts`) and
  **keeps the shared key**. The worker never sees it, and must never be given it: the bytes that cross the bridge
  are only what Telegram's protocol puts on the wire (the commitment, the two public values, the fingerprint).
- **The call's media never transits Cloudflare.** The audio is a WebRTC peer connection between the two browsers:
  Telegram's server hands out the relays (`phoneCall.connections`), the page turns the WebRTC ones into ICE servers,
  and the browser does the rest (Opus over DTLS-SRTP). What crosses Cloudflare is the _signalling_ — the session
  description and the ICE candidates — and that rides the `phone.sendSignalingData` relay, encrypted with the
  call's shared key. The envelope is Telegram's documented one (`pages/src/calls/crypto.ts`): the per-message key
  schedule, the 32-bit counter, the 64-message replay window. The `x` offset is anchored to the **caller**: the
  caller's packets use the outgoing offsets (0 transport / 128 signalling) and the callee's the incoming ones (8 /
  136), so both sides agree without negotiating it.
- **The call's signalling rides the updates socket, not `POST /user/rpc`.** A WebSocket message is not a Worker
  request, so a call setup does not spend the Free plan's daily request allowance; and the relay runs outside the
  Durable Object's input gate (`state.waitUntil`), so an ICE-candidate burst does not queue every other bridge call
  behind it. The `call_signaling` frame is the only client→server frame besides `hello` and `ping`.
- **A call is addressed by its id, and the access hash stays in the engine.** The bridge's rule is that peers are
  resolved server-side, and a call is a peer: `CallRegistry` (in the DO's memory) keeps the access hash of every
  call the engine has seen, and the browser only ever names a call by its id. The `call.*` methods are the one
  documented exception to the whitelist — they carry **opaque bytes** (the Diffie-Hellman values, the signalling
  packets), because those belong to the two peers. Everything else still resolves server-side.
- **A call pins the live session.** The signalling rides the account's Telegram connection, so the engine keeps that
  connection up while a call is up — even across a dropped browser socket, which would otherwise take the call with
  it in the gap before the browser reconnects (`session/lifecycle.ts`).
- **The call overlay is not a history layer.** Like the profile popup, it is a self-contained overlay: Back leaves
  the thread rather than closing the call. Only the media viewer is a `history.state` layer.
- **Secrets and deployment-specific Access vars are declared by hand in `worker/src/env.d.ts`.** The generated
  `worker-configuration.d.ts` only knows the bindings and vars in the template, so `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`
  (secrets) and `TEAM_DOMAIN`/`POLICY_AUD`/`ACCESS_DEV_BYPASS` (per-deployment configuration) are augmented there. The
  Access vars are not in the template because they are supplied through `WRANGLER_VARS_PATCH_JSON`; declaring them in a
  template would make wrangler infer literal `""` types. Any tsconfig whose program uses them must include that file
  (`test/tsconfig.json` does).
- **The test partition is a convention:** the SPA suite lives in `test/web/**` (the `defineRepoVitestConfig` web project's
  shape); everything else in `test/` runs under `node` as the backend half. `test/pwa/**` is the third kind: the
  service worker, the manifest and the icons are SPA code without a DOM, so their tests run under `node` too.
- **The CI workflow's `name:` is `Continuous Integration`** — CD's `workflow_run` trigger matches by workflow _name_, not
  filename. Job names (`Typecheck`, `Lint`, `Format`, `God Files`, `Unit Tests`, `Build Web App`) are the required-check
  names; keep them stable.
- **`pnpm run lint` uses `--fix`.** Run it locally and commit its fixes; CI's `--quiet` discards warnings, which is why the
  separate `format:check` job exists.
- **The god-file allowlist holds exactly the two contract modules.** `scripts/god-files.allowlist.json` exempts
  `worker/src/types.ts` and `pages/src/types.ts` from the hard cap: each is one mirrored contract (the SPA copy must stay
  in sync by hand), so splitting one is a mirror-wide refactor rather than a per-file fix. The `rpc-types.ts` split from
  `types.ts` was the last such split; anything else over 400 is split before it lands.
- **No `backup-d1.yml`.** The family's database backup exports D1, which this repo does not have; the DO's SQLite is
  covered by Cloudflare's point-in-time recovery, and it holds only the mtcute session, update state and small caches.
  The README's CI section says so where a reader would look for the workflow.
- **`minimumReleaseAge: 0` lives in `pnpm-workspace.yaml`.** pnpm 11 reads settings from there, not `.npmrc`; without it the
  default 24-hour window blocks installing a just-published `@rexezuge/tooling` release.

## Workflows

| Workflow                       | Trigger                                    | What it does                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `continuous-integration.yml`   | PR, push to `main`, upstream-sync dispatch | One job per gate — Typecheck, Lint, Format, God Files, Unit Tests (+coverage artifact), Build Web App — with Dependabot auto-merge and upstream-sync deployment dispatch as tails |
| `continuous-deployment.yml`    | CI success on `main`, manual dispatch      | `deploy-worker` (materialize config → dry-run gate → deploy) and `deploy-pages` (build → ensure project → deploy) in parallel                                                     |
| `backup-main.yml`              | push to `main`, monthly                    | Mirrors the repo to Azure DevOps / GitLab — opt-in by secrets; skips green when unset                                                                                             |
| `scheduled-version-update.yml` | 1st and 15th                               | Stamps `.github/.version` with the current unix timestamp                                                                                                                         |
| `upstream-sync.yml`            | weekly, manual                             | Dormant here (`if: github.event.repository.fork`); a fork of this repo points it at this repo                                                                                     |

Secrets/variables and the branch-protection checklist live in `README.md` (required settings) and are mirrored in the
workflow files themselves.

## Where this is going / out of scope

The session engine, the bridge (`POST /user/rpc`, `WS /user/updates`, the media routes `GET /user/file`,
`GET /user/avatar`, `POST /user/upload`, `POST /user/upload-group`), the Pages proxies, and the worker's Access JWT
verification are in place; what remains needs the owner. In order: (1) **M1 acceptance** — real QR login against the
account, one measured wake cycle — after `api_id`/`api_hash` exist; (2) the **72 h soak** at the 300 s cadence once the
deployment is up; (3) the
**`telegram-tt` fork** behind the existing bridge contract, once the Pages hostname is behind the Access application and
its `TEAM_DOMAIN`/`POLICY_AUD` are set. Both acceptance milestones run per `docs/session-engine.md`. Later concerns:
Secrets Store initialization, off-account DO storage backups (nothing to `d1 export`; the platform's
point-in-time recovery is the current answer), coverage floors, integration tests, and
`@cloudflare/vitest-pool-workers` once real DO tests exist.

**Voice calls are in place, with one honest gap.** The signalling plane (`phone.*` over the bridge, the call
registry, the `call`/`call_signaling` updates, the socket relay), the call UX (the overlay, the ringtone, the
thread header's ☎) and the media plane (the browser-side Diffie-Hellman exchange, the documented packet envelope,
the WebRTC peer connection) are all implemented. A call **between two instances of this client** works. A call
**with Telegram's own clients does not yet**, for two reasons, both in `docs/session-engine.md` under _Milestone 4_:
the payload inside the encrypted signalling envelope is this client's own format (Telegram's native clients speak
tgcalls' message format, which is not publicly specified), and the byte order of the key fingerprint is ambiguous in
Telegram's documentation. Both need a real account to settle.

## Keeping AGENTS.md current

Update this file when a change moves a boundary: a new workspace package, a new workflow or secret, a changed
materialization path, a changed test partition, or a copied script diverging further from the kit. The file is the index;
the reasoning belongs beside the code it explains.
