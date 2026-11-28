# AGENTS.md

Index for agents and humans working in this repository. Read `README.md` for the product overview and commands; this
file records the architecture, the load-bearing invariants, and the house conventions.

## Overview

**Pigeongram** (repository `Telegram-Web-Client`; internal identifiers keep `telegram-web-client`) is an always-online
Telegram web client on Cloudflare. The worker (`apps/api/`) is the backend —
a Hono API and a Durable Object (`SessionEngine`) that owns one Telegram account's MTProto session: a 5-minute alarm
wakes it to connect, replay `getDifference`, persist to DO SQLite and disconnect (the always-reachable baseline), and
while a browser socket is attached it holds the session live and pushes updates. The Pages app (`apps/web/`) is the Vite +
React front end (public intro, QR login, chat list, threads, scheduled messages), and the Pages Functions (`functions/`) proxy `/api/*` (public health)
and `/user/*` (Access-gated user API) to the worker over a service binding so the worker never faces the internet.
One account, single user, Free-tier-first: the 10 ms CPU per invocation and the 100,000 rows written/day limits are the
constraints the session engine is measured against. `docs/SESSION_ENGINE.md` is the engine's runbook. Deployment
configuration and first-deploy steps live in `docs/DEPLOYMENT.md`.

## Commands

House toolchain: Node 24 and pnpm 11.2.2 are Volta-managed (`~/.customrc` is sourced by the login shell; `volta run`
honours the `packageManager` pin). Every command below also works as `volta run pnpm …`.

| Command                           | What it does                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                    | Installs the workspace and runs `postinstall` → `pnpm run typegen`                                                        |
| `pnpm run typegen`                | Regenerates `worker-configuration.d.ts` from `apps/api/wrangler.template.jsonc`                                           |
| `pnpm run typecheck`              | `pnpm -r typecheck` (all workspace packages + test) + `typecheck:scripts` + `typecheck:functions` + `typecheck:web-build` |
| `pnpm run lint`                   | `eslint --fix --quiet .` under `--max-old-space-size=6144`                                                                |
| `pnpm run format:check`           | `prettier --check .` (read-only; the CI formatting gate)                                                                  |
| `pnpm run check:god-files`        | 300-line warn / 400-line hard gate (`--fail-on-hard`), tests and `scripts/` exempt                                        |
| `pnpm run check:dead-code`        | `knip`: unused files, dependencies and exports (`knip.json` records the entries and the copied-script exemption)          |
| `pnpm run validate:locales`       | bundle parity, placeholders, and two-way code↔catalogue key coverage (`scripts/validate-locales.ts`)                      |
| `pnpm run test` / `test:coverage` | Vitest, both projects (worker under `node`, SPA under jsdom)                                                              |
| `pnpm run checks:fast`            | typecheck + lint + format:check + god-files + dead-code + locales                                                         |
| `pnpm run checks`                 | `checks:fast` + `test:coverage`                                                                                           |

## Local development

Node 24 and pnpm 11 are required. Install dependencies and create the gitignored local variables file:

```bash
pnpm install
cp .dev.vars.example .dev.vars
```

Add `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` to `.dev.vars`, then start the worker and SPA in separate terminals:

```bash
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler dev
pnpm --filter @pigeongram/web dev
```

The worker runs on port 8787 and the SPA on port 5173. The SPA proxies `/api` and `/user` to the local worker.
Local development uses the example's `ACCESS_DEV_BYPASS` value with `ACCESS_DEV_EMAIL` as the identity it
authenticates as; the bypass is honored only outside production and must never be configured on a deployment.
`PAGES_ORIGIN` (`http://localhost:5173`) is what lets the Vite-proxied SPA pass the worker's origin check, because
the forwarded request's own URL origin is the worker's port, not the browser's.

## Architecture & invariants

### Layout

- `apps/api/` — the API worker. `src/index.ts` is the entry; `src/workers/ApiWorker.ts` owns the Hono app, `src/endpoints/`
  the route table and handlers (`/api/health` public, `/user/*` behind the Access gate, then the DO proxy), and
  `src/middleware/` the correlation, origin and Access checks. `apps/api/wrangler.template.jsonc` declares the DO
  binding (`SESSION_ENGINE`), the `v1` SQLite migration, `workers_dev: false` and `WAKE_INTERVAL_SECONDS`; the
  deployment-specific `TEAM_DOMAIN`/`POLICY_AUD` come from `WRANGLER_VARS_PATCH_JSON` and are declared in
  `packages/backend-runtime/src/env.d.ts`. The worker re-exports `SessionEngine` so wrangler discovers the class.
- `packages/` — `backend-services/src/session/` holds the engine (`engine.ts`) and its bridge modules (`rpc*`, `dto*`,
  `params`, `updates`, `media*`, `comments`, `stats`, `login-*`, `driver*`, `http`, `config`, `log`, `socket-hub`,
  `unread-albums`, `peers`, `archive`, `pin`, `call-*`); `provider-clients/src/mtproto/` holds the mtcute integration
  (`client`, `crypto`, `transport`, `sqlite`, `platform`); `backend-runtime/src/` is the platform seam (`base`, `config`,
  `di`, `constants`, `env.d.ts`); `shared/src/` is the single-sourced bridge contract (DTOs, RPC shapes, error codes,
  search, chat links, stickers and calls), re-exported by thin barrels in the apps. The engine's constructor is the
  DI composition root (`session/container.ts`): collaborators are bound once by branded token and resolved through the
  container, with `EngineDeps` overriding the three test seams.
- `apps/web/` — the SPA. `wrangler.template.jsonc` has the `pages_build_output_dir` and the `API_WORKER` service binding
  (consumed by `functions/`); `src/` is the React app (`api.ts` is the bridge client, whose domain calls live in `api/`
  and are re-exported from the barrel, `state/index.ts` the chat-list folds (with the pure reaction and poll folds in
  `state/reactions.ts` and `state/polls.ts`), `useDialogs.ts` the chat-list controller — the main list and the archive in one list, the live updates
  and the archive move — `useNewChat.ts` the new-message picker's contacts and Telegram-wide search,
  `i18n.ts` the i18next instance and one catalogue per shipped language in `locales/*/translation.json` (all twelve
  tags `@rexezuge/shared` supports; `useLanguage.ts` persists the choice, `format.ts` formats dates and numbers in
  that language, and `docs/I18N.md` holds the rules — English visible copy is Title Case, accessible-only copy lives
  under `a11y.*`, plural groups use i18next `_one`/`_few`/`_many`/`_other` suffixes with a base alias for the validator,
  and `validate:locales` is the gate),
  `useThread.ts`/`useComments.ts` the thread controllers — open, scroll-driven read receipts,
  send/attach/react and forward with a writable-destination picker; the comments controller's write half is
  `useCommentsSend.ts` and its live fold `useCommentsUpdates.ts` — `outbox.ts`/`useOutbox.ts` the optimistic send
  layer, `useScheduledMessages.ts`/`scheduled-state.ts` the scheduled queue beside the thread (an on-demand read, not
  an optimistic row), with `components/ScheduleSendButton.tsx` and `components/ScheduledMessagesDialog.tsx` as its
  overlays, `thread-window.ts` the opening-window read (the newest messages, a window around a linked post, or the unread
  watermark with its read context) and the forward-paging rule, `thread-state.ts` the loaded-range cursors and the
  live/sent/edit folds, `useThreadPaging.ts` the older/newer reads, `thread-paging.ts` the scroll-driven paging at
  either edge and the prepend anchor, `reading.ts` the unread-position logic they share, `components/` the
  screens). The calls live in `src/calls/` (`dh.ts` the
  browser-side Diffie-Hellman, `crypto.ts` the packet envelope, `exchange.ts` the key establishment, `peer.ts` the
  WebRTC peer and the signalling channel, `controller.ts` the call state machine, `session.ts` its reducer,
  `host.tsx` the hook that joins the calls to the updates socket, `signalling.ts` the payload format, `webrtc.ts` the
  peer connection, `ringtone.ts` the synthesised ringtone), with the overlay in `components/CallOverlay.tsx`. The home
  page has four states: `LandingPage.tsx` is
  the public intro, `OfflineScreen.tsx` the no-network screen, `LoginScreen.tsx` the Telegram QR login, and
  `LaunchScreen.tsx` the Access probe's first paint — a text-free launch splash drawn from the favicon's paper-plane
  mark, carrying a failed probe's message and retry on the same screen — `components/HomeScreen.tsx` picks among them
  from `useLoginFlow`'s `access: 'checking' | 'anonymous' | 'authenticated' | 'offline'`. `App.tsx` is only that picker
  (the login flow, `usePwa` and the height cap); the signed-in plane is `components/SignedInShell.tsx`, whose routing —
  the route, the archive screen, the viewer layer, links and read receipts — is `useSignedInNavigation.ts`.
  **UI chrome uses one icon set**: `apps/web/src/components/Icon.tsx` is the only place an interface
  icon is drawn — a filled 24-unit Material set, `currentColor`, `data-icon` for tests, decorative unless given a
  `label`. A new affordance adds an `IconName`, never another inline `<svg>`, a font glyph or an emoji; emoji are content
  (Telegram reactions and message text), not chrome. A successful
  `/user/state` probe means Access is through, and `state.authorized` then picks QR vs chat list. The intro's sign-in
  link is `/user/login`; the worker redirects it back into the SPA, carrying a validated same-origin `next` so a
  bookmarked chat link survives the Access round-trip. Navigation is pathname-based: `routes.ts` is the pure
  route grammar (`/`, `/archived`, `/settings`, `/settings/<section>`, `/chat/:id`, `/chat/:id/post/:id`,
  `/chat/:id/post/:id/comments`), `useRouter.ts`
  owns `location`/`history`/`popstate`, `useChatNavigation.ts` applies routes to the thread and comments controllers,
  and `useMediaViewer.ts` makes the media viewer a history layer on the same URL. `links.ts` is the Telegram link grammar
  (t.me URLs and `tg://` deep links normalized to one target) plus the native-app handoff, `telegram-links.tsx` the
  context that routes link clicks from message bodies (`components/MessageText.tsx`) — known chats open in the thread,
  a public chat the list does not carry is resolved through `resolveChat` and opens as a **transient preview**, and
  everything else Telegram goes to the installed app — and `richtext.tsx` the formatting/entity renderer. A preview is
  a chat the account has not joined: `useSignedInNavigation.ts` keeps it memory-only beside the search transients,
  `ThreadView` puts Join where the composer would be, the write affordances (reply, reactions, votes, callback
  buttons, comments) are withheld, and its scroll position never sends a read receipt. `joinChat` folds the joined
  chat into the open thread and reads the list again; `request_sent` and `webview` leave the preview in place and
  report the outcome (a guard bot's web view is handed to the installed app). A private invite link (`t.me/+hash`,
  `t.me/joinchat/hash`, `tg://join?invite=`) is resolved by the engine (`resolveInvite`): when the account is already in
  the chat it opens like a resolved link, otherwise `InviteDialog` shows what Telegram knows — title, kind, member count,
  approval — and `joinInvite` makes the join the reader asked for. Telegram names no peer for the unjoined case, so the
  card is a modal beside the thread rather than a route. A dead link is reported (`invite_expired`/`invite_invalid`),
  not handed off; only private `t.me/c` ids the engine does not already know still go straight to the app. Styling is
  Tailwind v4 through `@tailwindcss/vite`: `src/styles/tailwind.css` imports full Tailwind (preflight included) and
  layers the existing stylesheets under `components`, so legacy rules sit above preflight but below utilities. New UI
  should use utilities; extend a legacy sheet only for a genuinely shared rule. The installable app sits beside it:
  `sw/` is the service worker (its own tsconfig, the WebWorker lib), `build/pwa/` is the build-time half (the icons,
  the manifest and the local Vite plugins that write them), `src/pwa/` is the runtime half (the registration and the
  install prompt), and `public/_headers` carries the cache headers Pages serves with the static assets.
- `android/` — `template/`, the deployment-agnostic native WebView shell (Java, Gradle and resources with placeholders).
  The generated Gradle project is produced under `android/build/` in CI and is never committed.
- `functions/` — Pages Functions, always at the **repo root** (not under `apps/web/`), because the config wrangler reads
  for them is the materialized root `wrangler.jsonc`. `api/[[path]].ts` and `user/[[path]].ts` are pass-throughs to
  `env.API_WORKER`; they must not import workspace packages (Pages bundles them separately).
- `docs/` — `SESSION_ENGINE.md`: engine architecture, bridge API table, local dev, M1 spike + M2 soak runbooks,
  troubleshooting. `PWA.md`: the service worker's rules, the install build, the offline state, and how to verify it.
  `ANDROID.md`: the per-deployment WebView shell build, signing, Play notes and trust model. `DEPLOYMENT.md`: deployment config,
  secrets/variables and required checks. `TELEGRAM_WIDGETS.md`: why a widget
  post arrives with no content, what the placeholder card is, and the layer-233 upgrade path. `I18N.md`: the copy
  catalogue, the Title Case / `a11y.*` split, how to add a language, and the validator.
- `test/` — a **workspace package**, deliberately: an unhooked out-of-workspace `test/` cannot resolve workspace
  dependencies under pnpm's strict layout. If a bare import fails, add the dependency to `test/package.json` — never loosen
  the workspace.
- `scripts/` — copies of `@rexezuge/tooling`'s entrypoints (`check-god-files.ts`, `prepare-wrangler-config.ts`) plus their
  import closure (`lib/`, `wrangler-config/`). They are copies on purpose (the kit documents repository-local copies as the
  intended use) and carry two local adaptations, both marked with an "Adapted from the kit" comment:
  1. `wrangler-config/types.ts` — the template default is `apps/api/wrangler.template.jsonc`.
  2. `prepare-wrangler-config.ts` — `provisionWranglerResources({})`, because this worker has no KV cache binding and must
     not have the family default (`CACHE`) added to its config.
     On a `@rexezuge/tooling` bump, diff and re-sync these files.
- `scripts/android/` — this repository's own, **not** a kit copy: one entrypoint per Android Build workflow step, with
  each step's rules exported for `test/android/`. Leave this directory out of the tooling re-sync; `docs/ANDROID.md`
  names the entrypoints.

### Load-bearing details

- **Visible copy is Title Case; accessible-only copy stays sentence case.** Every word of authored, user-visible
  text is capitalised — buttons, menu items, headings, prose, placeholders, statuses, empty states and toasts
  (`Load Older Messages`, `Sign In With Cloudflare Access`, `No Chats Yet.`, `Search Messages`). Articles,
  prepositions and conjunctions are capitalised too, and single words stay as they are. Dynamic interpolations keep
  their own casing (`Forwarded To ${chat.title}`, dates, units such as `5m`/`30s`, server text and user content).
  Non-visible accessible copy — `aria-label`, `title`, `alt` and `sr-only` — keeps sentence case. Keep the
  accessible name in step with the visible label when both exist. **The copy lives in
  `apps/web/src/locales/en/translation.json`, and the namespace is the boundary the guard reads**:
  `test/web/copy-style.test.ts` holds every key outside `a11y.*` to Title Case and exempts `a11y.*`, which is where
  accessible-only strings go. A new visible string is a catalogue key with the English default passed as `t()`'s
  second argument — never a literal in TSX — because `validate:locales` checks both directions of that link.
- **The product was renamed to Pigeongram; `telegram-web-client` is the internal name.** Telegram's Terms of Service
  forbid a third-party product from using “Telegram” in its name, so every user-visible brand surface — the document
  title, the PWA `name`/`short_name`, the intro and offline eyebrow, and the Android app/launcher defaults — reads
  `Pigeongram`. Descriptive references to the service (“Sign In To Telegram”, “Open In Telegram”) stay. The repository,
  the `@pigeongram/*` packages, the worker and Pages project names,
  `history.state.app === 'telegram-web-client'`, the `/api/health` `service` value and `TELEGRAM_API_*` are identifiers,
  not branding; renaming one is a migration. The Pages build resolves `VITE_APP_NAME`/`VITE_APP_SHORT_NAME` in
  `apps/web/branding.ts` (default Pigeongram) and applies them through `apps/web/src/app-name.ts`, `createManifest` and
  `pwaBrandingPlugin`; CD passes the repository variables of the same names, and the Android workflow uses its own
  `ANDROID_APP_NAME`/`ANDROID_LAUNCHER_NAME` first, then those variables, then Pigeongram.
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
- **A media type newer than our MTProto layer arrives as `messageMediaUnsupported`, with its caption blanked.** Telegram
  replaces the payload and the text for a media type the advertised layer cannot read, so mtcute reports no media and no
  text; the message would reach the SPA with nothing to render. The engine names it `MessageMediaDto.kind: 'unsupported'`
  and never `null`, the SPA renders `MessageUnsupported` (a labelled card with an _Open In Telegram_ link built from
  `messageWebLink`), and a message with no media, text, poll or preview gets the same card. Layer 233 Widgets are a media
  kind of their own now: the engine carries the zlib payload as base64 and the server's flags in `MessageMediaDto.widget`,
  and the SPA inflates it and renders it read-only in the official `@telegram/widget-sandbox` (strict policy, no
  `onRequest`, no state or storage callbacks). Never render bot-supplied widget HTML in a hand-rolled iframe: the
  sandbox's validator, quotas and lifecycle are the security boundary. Its SharedArrayBuffer bridge needs the three
  cross-origin isolation headers in `apps/web/public/_headers` and the local bundling plugin in development; without
  them the bubble falls back to the labelled card. The sandbox is a pinned Git dependency whose bundles are prebuilt by
  `apps/web/build/widget-sandbox-bundles.ts` and served by `widget-sandbox-plugin.ts`; `docs/TELEGRAM_WIDGETS.md` holds
  the runbook and the interactive follow-up.
- **Bridge failures carry a stable code, and the engine logs one JSON line per event.** `EngineError` derives a coarse
  `code` from its status (`validation`, `not_found`, `conflict`, `access`, `rate_limited`, `upstream`, `unavailable`,
  `internal`) and a call site may name a more specific one; `errorResponse` sends the canonical
  `{Exception: {Type, Message}}` envelope still additively, `EngineConfigError` is `config`, and an exhausted write budget
  keeps `storage_write_quota`. The SPA reads the envelope's `Type`. `session/log.ts`
  writes `{level, event, …fields}` through the matching console method, so Workers Logs and tests query fields instead of
  prose; `session/config.ts` reads `WAKE_INTERVAL_SECONDS`, `UPLOAD_MAX_BYTES` and the media window once per engine (and
  once per upload pre-flight at the edge). Do not parse an env bound inside a request handler again.
- **Telegram's refusals are mapped, never masked as 500s.** `session/rpc-errors.ts`'s `rpcErrorToEngineError` turns a
  peer Telegram no longer offers and a message that left the chat into `404 not_found`, a forbidden write into
  `403 access`, `REACTIONS_TOO_MANY`/`MESSAGE_NOT_MODIFIED` into `409 conflict`, and `FLOOD_WAIT_%d` into
  `429 rate_limited`; any other refusal is a `400 validation` carrying Telegram's own code text. The same mapping runs at
  the HTTP boundary (`session/http.ts`, which logs `request.refused` at warn) and per failed call inside a `batch`
  (`RpcBatchOutcome.code`, which `batchResult` turns back into the status). A new Telegram code that should mean
  "gone"/"forbidden"/"conflict" belongs in that map, not in a caller's string comparison.
- **A chat the account no longer has is a state of the SPA, not a retry.** A `404 not_found` on a thread open sets the
  controller's `unavailable` flag: `ThreadUnavailable` replaces the message list and the composer, and
  `SignedInShell` drops the chat from the merged list (`useDialogs.drop`). Retrying cannot bring the chat back; the next
  chat-list read is the truth, so a row dropped wrongly (a transient failure that mapped to 404) returns on its own.
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
  reader could reach them. The rule lives in `apps/web/sw/routes.ts` as a pure function and is asserted by
  `test/pwa/routes.test.ts`. The navigation case matters most: `/user/login` is where Access runs its login flow, so a
  navigation to it must reach the edge — answering it with the precached shell would swallow the redirect and the
  sign-in would never happen. Every other navigation falls back to the precached `index.html`, which is the document
  Pages serves for a pathname route anyway.
- **Browser push fills the gap when no tab is attached.** Web Push is optional and per deployment: the VAPID private key
  is a worker secret (`VAPID_PRIVATE_KEY`) and its public point is the build-time `VITE_VAPID_PUBLIC_KEY`; neither is in
  the wrangler template, and changing one invalidates every subscription. The Settings toggle subscribes through the
  Access-gated `POST /user/push/subscribe`, and the engine keeps one row per device in `engine_push_subscriptions`
  (`session/push-subscriptions.ts`, bounded at 12, cleared on logout). `SessionEngine.handleEvent` offers new messages
  to `session/push-notifier.ts` **only while not live** — a wake's `getDifference` is precisely when a notification is
  useful — and the notifier deduplicates, coalesces and flushes through `lifecycle.background`, so signing and delivery
  never hold the input gate and a delivery never writes a row. The payload is RFC 8291-encrypted with WebCrypto and the
  VAPID JWT is ES256; `apps/web/sw/push.ts` only reads the browser-decrypted JSON and opens `/chat/:id` on a click. The
  SW's notification copy is Title Case too, asserted by `test/pwa/push.test.ts`; `docs/PWA.md` and
  `docs/SESSION_ENGINE.md` hold the runbooks.
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
- **The Android wrapper is a per-deployment WebView shell, not a browser shortcut.** A TWA would hand navigation to the
  device's browser and fall back to the default browser when Digital Asset Links fail or Chrome is absent; the shell
  instead hosts the deployed origin in its own `WebView`, so the PWA opens in-app whatever the default browser is. The
  app renders no local bridge and no privileged API: the worker remains the only API surface. `android/template/` is the
  only committed Android config; `.github/workflows/android-build.yml` renders it into `android/build/`, builds with
  Gradle, and uploads APK/AAB artifacts. It is dispatch-only and never publishes an upstream-signed release: each
  deployment uses its own origin, package id and keystore, and must not install another deployment's build. The workflow
  checks the live origin and manifest before building, so Pages has to be deployed first.
  The back gesture is delegated to the page: the shell targets SDK 36, where Android 16 no longer calls `onBackPressed`,
  so `MainActivity` registers an `OnBackInvokedCallback` (with `onBackPressed` kept for API 24–32) and asks
  `window.__pigeongramBack`, which the signed-in navigation installs from `apps/web/src/native-back.ts`. That function is the
  in-app back button — the media viewer's history layer, a chat/comments/archive step — and answers "nothing to go back
  to" only on the chat list, where the shell exits. When it is absent (the login screen, or a web build older than the
  seam) the shell falls back to `copyBackForwardList()` and `history.back()`, never `canGoBack()`/`goBack()`, which go
  stale for the entries `useRouter` seeds with back-to-back `replaceState`/`pushState`. The page exposes a boolean and
  gains nothing native, so this is not the privileged bridge the shell deliberately lacks.
  JavaScript is deliberately enabled: the deployed origin is a React SPA and a WebView with JS disabled would be blank.
  CodeQL's `java/android/websettings-javascript-enabled` alert is suppressed at the call with that justification; the
  shell exposes no `addJavascriptInterface` bridge, refuses cleartext, file and `content://` access, and keeps the account
  API behind Access, which is what makes the exception safe. Ordinary web links can still load in the WebView.
- **The signed-in shell fits above the keyboard and the browser chrome.** `.app` is `height: 100dvh` capped by
  `--app-height` through a **`max-height`**. `dvh` is the dynamic viewport: it follows Chrome Android's auto-hiding URL
  bar, which the layout viewport (`100%`) deliberately does not (it stays at the URL-bar-shown height), and under
  `interactive-widget=resizes-content` the keyboard shrinks it too. `useAppHeight` writes the smaller of
  `document.documentElement.clientHeight` and `window.visualViewport.height` into the cap for the case `dvh` misses — an
  overlaid keyboard (iOS Safari) does not shrink it. Taking the minimum keeps the composer above a keyboard that one
  viewport lags in reporting, and the cap can only shorten the shell: folding the two back into one `height` lets the
  cap sit a fraction of a pixel above the viewport (the hook floors rather than rounds, but `clientHeight` is itself
  rounded), and Chrome draws a scrollbar for that much overflow. The hook observes the root (`ResizeObserver`) and both
  the visual viewport's `resize` and `scroll` events, and `settleToBottom` re-pins both scroll views on the resulting
  host resize. Don't go back to `height: 100%` (the URL bar is then missed), and don't drop the cap either.
- **Sends are optimistic, but the thread and the dialogs stay server truth.** `apps/web/src/outbox.ts` (the entry shape and
  the chat-list overlay) and `apps/web/src/useOutbox.ts` (the bridge round trip) keep pending sends in their own layer: a
  `PendingMessage` renders beside the loaded messages (`components/PendingMessageRow.tsx`) and is folded over the
  dialogs for the sidebar preview only. Never inject a synthetic message into `ChatThread.messages` or
  `DialogDto.lastMessage`: message ids, read watermarks, unread counts and reply lookups are read from the server, and a
  pending row with a negative id would poison all of them. Dropping the entry is the whole rollback. Text sends are
  chained per chat so rapid messages keep their order, uploads run independently so a large file never delays the next
  text, and a failed send stays as a "Not sent" bubble with Retry/Discard. A retry reuses the entry's `randomId`, so
  Telegram drops the duplicate if the first attempt actually landed — the engine validates that id like any other
  parameter (`packages/backend-services/src/session/params.ts`, and `packages/backend-services/src/session/upload-spec.ts` for the upload query). An album
  (`POST /user/upload-group`) has no client-chosen id: Telegram picks the group's, so a retried album is a new album.
- **A scheduled message is server truth too, held in its own queue.** `getScheduledMessages` reads Telegram's queued
  messages on demand (the header menu opens the list); they never enter `ChatThread.messages` or
  `DialogDto.lastMessage`, because a message with a future date is not in the history yet and would poison ids,
  watermarks and reply lookups. `scheduleDate` is unix milliseconds UTC, bounded at the engine to a 30-second minimum
  lead and a one-year horizon; mtcute calls it `schedule` on a send and `scheduleDate` on an edit, and the engine owns
  that translation. `sendMessage`/`editMessage` mark an accepted write `scheduled` so the engine echoes
  `scheduled_new`/`scheduled_edit` instead of the ordinary thread events, and raw Telegram updates map to the same
  variants on other sessions. `sendScheduled` echoes `scheduled_deleted` with the live copies, which the SPA folds
  into the thread; a plain delete has only ids. There is no pending row for scheduling — the engine's echo is the
  acknowledgement, and a refusal is a toast. A scheduled edit keeps the message's original send time.
- **A delete is for everyone, and the chat list is repaired from the thread's own fold.** `deleteMessages` always
  passes `revoke: true`: Telegram's "delete for me" is session-scoped, so the message would reappear on the next read.
  The SPA deletes optimistically (`apps/web/src/useMessageDelete.ts`: the rows go before the answer, a refusal puts
  them back and toasts), and the engine echoes a `deleted` update after the call because mtcute swallows the delete's
  own update as a quiet pts step — a second tab would otherwise keep the message. The account-level
  `updateDeleteMessages` carries no peer, so that event's `chatId` is null and the SPA folds it by matching the loaded
  ids; a channel's (`updateDeleteChannelMessages`) is exact. The chat list's preview and badge are repaired from the
  open thread's fold, which alone can say what left the window and what remains: ids alone cannot tell whether a
  chat's last message or an unread one was among them. The engine prunes deleted ids from the album ledger, since a
  deleted unread album member is never read. `ChatDto.canDeleteMessages` gates deleting someone else's message
  (creator, or an admin with `delete_messages`; a basic group's admin always); the account's own messages are always
  deletable and the SPA decides that itself.
- **The worker is not publicly routable.** `workers_dev: false` and no route: the only caller is the Pages Functions
  (`API_WORKER` service binding). The API surface is split by prefix: `/api/*` is public and carries only
  `GET /api/health`; everything account-scoped lives under `/user/*`, where every request verifies the Cloudflare
  Access assertion (`Cf-Access-Jwt-Assertion`) in `apps/api/src/middleware/MiddlewareHandlers.ts`, via the kit's
  `authenticateAccess` — RS256 signature against `${TEAM_DOMAIN}/cdn-cgi/access/certs`, issuer, `POLICY_AUD`, and
  expiry — before forwarding to the DO. The Access
  application's policy is the allowlist; the worker deliberately does not check the email. `/api/health` is public and
  carries no account data. When `TEAM_DOMAIN`/`POLICY_AUD` are absent or malformed, `/user/*` answers
  `503 {"code":"access_config"}` — never an unauthenticated fallback. At the edge, the Access application must be
  **path-scoped to `/user*`**: `/`, the SPA assets, and `/api/health` stay public, while the account API and the
  `/user/login` entry point are gated. A host-wide application with only `/api/*` bypassed would also gate the public
  intro. `GET /user/login` redirects to a validated same-origin `next` path (default `/`), so Access's return trip
  lands back in the SPA instead of on the engine. The Access app must be a **self-hosted** app on the Pages hostname,
  not a Worker-destination app: the latter
  rejects WebSocket upgrades. `ACCESS_DEV_BYPASS` skips verification only while `ENVIRONMENT !== "production"` and
  belongs in `.dev.vars` only; `ACCESS_DEV_EMAIL` is the identity it authenticates as, so a bypass with no address
  fails closed rather than opening the account plane. Do not add an `/api/*` catch-all that forwards to the DO: the public plane must never
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
  (`packages/backend-services/src/session/unread-albums.ts`) is what makes the two agree: it records the album members the update stream
  delivered, drops the ones a read covered, and the surplus (the members beyond the first of their album) is
  subtracted from the count `getDialogs` serves and from the `unread` a `read` update carries. The ledger lives in the
  DO's SQLite because the engine sleeps between its wakes, and it learns from the update stream, so it costs no
  Telegram traffic. A fresh sign-in starts with an empty ledger, so the first `getDialogs` reconciles it: it reads the
  unread range of every chat with unread messages, once per sign-in. On the SPA side, `DialogMessageDto.groupedId`
  says that a new message continues the album the chat list already counted, and the optimistic read-through
  subtracts albums rather than messages (`apps/web/src/groups.ts`).
- **One request is one Durable Object event, and the DO hands out one event at a time.** Two bridge calls therefore cost
  two round trips in sequence, whatever the browser does — and each one costs a Telegram round trip on the far side.
  Inside one event mtcute's transport multiplexes, so the lever is **fewer events and more concurrency inside each
  event**. `POST /user/rpc`'s `batch` method is that mechanism: it runs several **read-only** methods in one request,
  concurrently, over the one connection. The whitelist is deliberate — a batch runs its calls concurrently, so a write
  would have no defined completion order, and `readHistory` is excluded because it moves the account's read watermark.
  Per-call failures are reported per call, so one broken read never takes the reads beside it down. When a screen needs
  several reads, read them together in one batch (`apps/web/src/api.ts`: `fetchBootstrap`, `fetchChatScreen`) rather than
  chaining requests — a chained pair is exactly the waterfall the batch exists to remove.
- **The archive is a peer folder, and a read of its own.** Telegram keeps the archived chats in the peer folder with
  the id `1`; every other chat is in folder `0`. `getDialogs` reads the chat list without the `archived` flag
  (`folder_id: 0`) and the archive with it (`folder_id: 1`), and `setArchived` moves a chat between the two through
  `folders.editPeerFolders` — the API the official clients use for the archive. The two reads stay apart on purpose: one
  limit over both would cost the chat list the chats the archive holds, and the archive is a screen the reader asks
  for, not one every list load pays for. On the SPA side the archive is a screen of its own (`/archived`, reached from
  the account popup), and the chat list and the archive live in **one** list (`apps/web/src/useDialogs.ts`), so every
  lookup of a chat — the router, the thread, the read receipts, the forward picker — finds it in the same place. A chat
  opened from the archive keeps the archive list in the sidebar; bringing the open chat back out of the archive hands
  the sidebar back to the chat list, where the chat now lives. The archive bar's back leaves that list for the chat
  list too: while one of its chats is open it changes only the sidebar, so the open thread stays.
- **Pinning is per folder, optimistic, and repaired by the update stream.** `setPinned` calls
  `messages.toggleDialogPin` with the requested flag, so the main list and the archive keep independent pinned blocks.
  The chat list's context menu offers Pin/Unpin: pinning moves the row to the top of the pinned block and unpinning
  drops it at the top of the unpinned one, with the same rollback on a refused call as `setArchived`. The engine maps
  `updateDialogPinned` onto a `pinned` event and the SPA folds it into whichever list already holds the chat; the pin
  marker in the row stays a render of `DialogDto.pinned`, never a local-only flag.
- **A sticker is named by an id the engine minted, and the picker is a popover.** The composer's emoji button opens
  `apps/web/src/components/StickerPicker.tsx` (stickers) and `EmojiPicker.tsx` (emoji) above the composer — a popover,
  not a `history.state` layer, so Back leaves the thread. The library (`getStickerLibrary`: recents, saved stickers and
  the installed regular packs, one engine event) is read the first time the sticker tab is shown; a _brief_ pack
  carries no stickers, so `getStickerSet` reads it in full when the reader opens it. A sticker crosses the bridge as
  the decimal document id the engine minted (`StickerDto.id`), never as a file id or `file_reference`:
  `session/sticker-registry.ts` keeps the documents it has read (memory-only, bounded), and `GET /user/sticker`
  streams one from there — `thumb=1` answers the thumbnail a picker cell needs, and an id the registry lost is a `404`,
  not a Telegram round trip. Because the registry empties on a Durable Object restart, `sendSticker` also accepts the
  pack identity (`set: {id, accessHash}`) as the cold-start fallback. Installing a `t.me/addstickers` link is the
  whole action that link has (`installStickerSet`); it names no peer. Emoji are content, not chrome: the composer's
  set is `apps/web/src/emoji.ts` (in-repo data with keywords, recents in `localStorage`), and a pick inserts at the caret
  and leaves the panel open, because a message is often several emoji. The picker button renders only when the composer
  was given `onSendSticker`, and the sticker tab is withheld while a message is being edited.

- **The profile popup is a self-contained overlay, not a history layer.** The nav bar of the open chat opens the
  peer's profile — from its picture, from its name, or from the ⋮ menu's "View Profile" — and the popup closes on
  Escape, a backdrop press or its close button. It is deliberately **not** a `history.state` layer (only the media
  viewer is), so Back leaves the thread, as it does for the forward picker. The profile is read on demand
  (`getProfile`, a read-only method on the batch whitelist) rather than with the chat screen: the reader asks for it
  by opening it, and a thread open would otherwise pay for a read nobody looks at. The popup lives in the thread header
  (`apps/web/src/components/ThreadHeader.tsx`), so the signed-in shell does not grow.
- **Settings is a routed screen, not a popup.** `apps/web/src/components/SettingsScreen.tsx` paints
  `/settings` and `/settings/<section>` (`appearance`, `notifications`, `data`) over the shell without unmounting it:
  the chat list and the thread behind it keep their scroll position and loaded window, and `useChatNavigation.ts`
  returns early for a settings route. Two navigations live in one screen — at 900px and up a rail lists the sections
  and choosing one **replaces** the history entry (a tab switch, so leaving settings stays one back press); narrower
  than that the index is the screen and a section is **pushed**, so back returns to the index
  (`useMediaQuery.ts` supplies the width, defaulting to the narrow layout where `matchMedia` is absent). The account
  menu stops owning any settings state (`UserMenu.tsx` calls `onOpenSettings`), and the device choices stay where they
  were: the theme in `useTheme`, the seed and contrast in `useDynamicColor`, every data-saver switch in
  `data-saver.tsx` — whose master switch turns all of `DATA_SAVER_KEYS` on or off and reports the mixed state through
  `ToggleSwitch`'s `indeterminate`.
- **A min peer in mtcute's cache turns a valid chat into `PEER_ID_INVALID`.** Telegram's `min` user/channel carries a
  reduced access hash that only works inside an `inputPeer*FromMessage`, and mtcute's in-memory peer cache hands a
  cached peer back from `storage.peers.getById` without the `isMin` check its SQLite branch has
  (`@mtcute/core@0.32.8`, `highlevel/storage/service/peers.js`), so `resolvePeer` can pass a min hash to a regular call.
  A chat that is a dialog — a full peer in storage — starts failing that way after a min copy of it arrives from a
  group's or channel's message list, which is why the official app still opens it and a reload sometimes does.
  `session/peers.ts` is the guard: `withPeerRetry` wraps every peer-addressed bridge call (the batch's per-call dispatch,
  `driver.rpc`, media streams, avatar reads, uploads) and retries **once** on
  `PEER_ID_INVALID`/`CHANNEL_INVALID`/`USER_ID_INVALID`, healing the cache first in escalating steps — re-store the full
  entity mtcute already holds when the cached input hash differs from it (`cache`), refresh through
  `resolvePeer(id, true)` (`resolve`) — and, as the last resort, scan the account's dialog list (`client.iterDialogs`,
  bounded by `DIALOG_SCAN_LIMIT = 500`, `dialogs`). The scan is what recovers a username-less channel: `channels.getChannels`
  refuses its zero access hash, and `findDialogs` throws through the same poisoned cache. `peer.refreshed` names the ids
  and the step; `via: none` means no step found the peer, so the chat really is gone from the account. A rejected peer was
  never acted on, so the retry is safe for writes too. Do not try to solve this by upgrading mtcute (0.32.8 has the same
  cache) or by guarding the peers repository alone — mtcute's `PeersService` caches the min input peer independently.
- **The replay of the missed updates runs outside the input gate.** `session/lifecycle.ts` owns the wake and live modes;
  `startLive` connects and then hands the `getDifference` catch-up to `state.waitUntil`, because it is the longest event
  in the system and holding the gate for it queued every bridge call behind it. The engine's storage warms up in
  `blockConcurrencyWhile` in the constructor, so the migrations are not on the first request's critical path.
- **Media routes are gated too.** `<img>`/`<video>`/`<audio>` cannot set headers, so they rely on the same-origin
  Access session cookie the browser sends with every request; Access forwards the assertion for the worker to verify.
  There is no token query parameter. `POST /user/upload` takes the file as the raw request body,
  streams it straight into mtcute's upload pool, and is capped by `UPLOAD_MAX_BYTES` (default 100 MB) — that var is
  also the upload-CPU affordability knob. The upload query is validated a second time in the outer worker (same
  parser, `apps/api/src/endpoints/upload.ts`): workerd reads a request stream after its response when a Durable Object answers
  without consuming the body (cloudflare/workerd#918), so malformed and oversized uploads must never reach it.
- **Albums are one request body, not many.** `POST /user/upload-group` carries 2–10 files concatenated in the order
  the `manifest` query parameter (base64url JSON) declares, and `session/upload.ts` splits that one body back into the
  exact byte ranges (`UploadBodySplitter`) before mtcute's `sendMediaGroup` uploads them in order. The parser
  (`session/upload-spec.ts`) is shared by the engine and the edge, and it enforces the album rules: 2–10 items, one
  media class (photos/videos/GIFs together, documents together), and a total within `UPLOAD_MAX_BYTES`. The split
  streams use `highWaterMark: 0` on purpose — with the default of 1, Web Streams pulls every part at construction, so
  the later files would claim the shared reader before the earlier ones. The composer's upload dialog
  (`apps/web/src/components/UploadDialog.tsx`) is the review step: it caps the selection at 10, offers "Group Items"
  (checked by default when the selection can group) and sends ungrouped files one by one. It also offers "Send As
  File" (off by default, Telegram's own compression default): every item then goes as a `document` with its original
  bytes, name and MIME — no canvas JPEG conversion, no Telegram photo/video transcode — which is the only way an
  original survives, since a photo message has no original on Telegram's side. Its thumbnail column only
  previews raster images (`previewMime` in `apps/web/src/upload.ts`, which keeps SVG out), and the preview blob is built
  with that MIME type, so the object URL behind it can never be read as a document. A paste into the composer opens
  the same review step with the pasted files as the selection (`apps/web/src/clipboard.ts` reads the clipboard): the
  draft rides along as the caption, exactly as it does for the file picker. Only a clipboard without text is taken
  over — a cell copied from a spreadsheet arrives as text _and_ an image of the cell, and there the text is what the
  user meant to paste, so the browser keeps it.
- **A voice note is recorded in the browser and uploaded as one file.** The composer's empty-draft send button is the
  microphone (`apps/web/src/components/Composer.tsx` and `useVoiceRecorder.ts`): pressing it opens the microphone, shows a
  live timer with Cancel/Stop And Send, and hands the finished recording to the same file path an attachment takes, with
  `kind: 'voice'` and the measured duration forced (`apps/web/src/upload.ts`, `apps/web/src/outbox.ts`). The encoder is
  `opus-recorder`, which produces the Ogg/Opus container Telegram's own clients use, and it is loaded lazily through
  `apps/web/src/recorder-loader.ts` on the first press, so its WebAssembly bundle never rides the first paint. That one
  worker script embeds the wasm as a data URI, so `apps/web/build/recorder-plugin.ts` copies only
  `encoderWorker.min.js` into `recorder/` for the build and the dev server. The recording stops by itself at
  `VOICE_MAX_SECONDS` (300 s), the SPA clamps the duration it reports to `1..300`, and the shared parser
  (`session/upload-spec.ts`) refuses a `kind=voice` upload whose duration is absent or past the cap, before the body is
  read. The engine maps it to `InputMedia.voice` (`session/upload.ts`); there is no transcode, no storage and no
  waveform — Telegram generates the waveform. A refused microphone or an unsupported browser is an inline `role="alert"`
  in the composer, never a silent failure or a webm note. A voice note is never grouped into an album: the parser
  refuses it there and `sendUploadBatch` keeps it on the single-file path.
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
  `messages.getDhConfig` and hands `p`/`g` down; the browser does the arithmetic (`apps/web/src/calls/dh.ts`) and
  **keeps the shared key**. The worker never sees it, and must never be given it: the bytes that cross the bridge
  are only what Telegram's protocol puts on the wire (the commitment, the two public values, the fingerprint).
- **The call's media never transits Cloudflare.** The audio is a WebRTC peer connection between the two browsers:
  Telegram's server hands out the relays (`phoneCall.connections`), the page turns the WebRTC ones into ICE servers,
  and the browser does the rest (Opus over DTLS-SRTP). What crosses Cloudflare is the _signalling_ — the session
  description and the ICE candidates — and that rides the `phone.sendSignalingData` relay, encrypted with the
  call's shared key. The envelope is Telegram's documented one (`apps/web/src/calls/crypto.ts`): the per-message key
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
- **Secrets and deployment-specific Access vars are declared by hand in `packages/backend-runtime/src/env.d.ts`.** The generated
  `worker-configuration.d.ts` only knows the bindings and vars in the template, so `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`
  (secrets) and `TEAM_DOMAIN`/`POLICY_AUD`/`ACCESS_DEV_BYPASS` (per-deployment configuration) are augmented there. The
  Access vars are not in the template because they are supplied through `WRANGLER_VARS_PATCH_JSON`; declaring them in a
  template would make wrangler infer literal `""` types. Any tsconfig whose program uses them must include that file
  (`test/tsconfig.json` does).
- **The test partition is a convention:** the SPA suite lives in `test/web/**` (the `defineRepoVitestConfig` web project's
  shape); everything else in `test/` runs under `node` as the backend half. `test/pwa/**` is the third kind: the
  service worker, the manifest and the icons are SPA code without a DOM, so their tests run under `node` too.
- **The CI workflow's `name:` is `Continuous Integration`** — CD's `workflow_run` trigger matches by workflow _name_, not
  filename. Job names (`Typecheck`, `Lint`, `Format`, `God Files`, `Dead Code`, `Locales`, `Unit Tests`, `Worker Bundle`,
  `Build Web App`) are the required-check names; keep them stable. `Worker Bundle` always reports (so it is safe as a required check) but only
  installs and runs `wrangler deploy --dry-run` when the change set touches `apps/api/`, `packages/`, the wrangler
  config materializer (`scripts/prepare-wrangler-config.ts`, `scripts/lib/`, `scripts/wrangler-config/`), or the
  workspace/dependency manifests (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`).
- **`pnpm run lint` uses `--fix`.** Run it locally and commit its fixes; CI's `--quiet` discards warnings, which is why the
  separate `format:check` job exists.
- **The god-file allowlist holds exactly one contract module.** `scripts/god-files.allowlist.json` exempts
  `packages/shared/src/types.ts` from the hard cap: it is one mirrored contract, so splitting it is a contract-wide
  refactor rather than a per-file fix. The SPA's `apps/web/src/types.ts` is a 14-line re-export barrel and needs no
  exemption. The contract is single-sourced in `packages/shared/`, and `apps/web/src/types.ts` re-exports it, so a
  change reaches both ends without a manual mirror. The `rpc-types.ts` split from
  `types.ts`, and the later `search-types.ts` and `chat-link-types.ts` splits from `rpc-types.ts`, were the last such
  splits; anything else over 400 is split before it lands.
- **No speculative exports.** An export exists because a caller outside its module uses it: a helper only its own module
  calls stays private, and an unreferenced symbol is deleted rather than kept for a later screen. `knip` is not the guard
  here, because it false-positives on the mirrored contract modules — their exports are the contract, not dead code.
- **No `backup-d1.yml`.** The family's database backup exports D1, which this repo does not have; the DO's SQLite is
  covered by Cloudflare's point-in-time recovery, and it holds only the mtcute session, update state and small caches.
  `docs/DEPLOYMENT.md` says so where a reader would look for the CI workflows.
- **`minimumReleaseAge: 0` lives in `pnpm-workspace.yaml`.** pnpm 11 reads settings from there, not `.npmrc`; without it the
  default 24-hour window blocks installing a just-published `@rexezuge/tooling` release.

## Workflows

| Workflow                       | Trigger                                    | What it does                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `continuous-integration.yml`   | PR, push to `main`, upstream-sync dispatch | One job per gate — Typecheck, Lint, Format, God Files, Dead Code, Unit Tests (+coverage artifact), Worker Bundle (dry-run, path-filtered), Build Web App — with Dependabot auto-merge and upstream-sync deployment dispatch as tails |
| `continuous-deployment.yml`    | CI success on `main`, manual dispatch      | `deploy-worker` (materialize config → dry-run gate → deploy) and `deploy-pages` (build → ensure project → deploy) in parallel                                                                                                        |
| `android-build.yml`            | manual dispatch                            | Per-deployment WebView shell: verifies the live origin, renders the Gradle project, builds the signed APK/AAB, uploads artifacts only                                                                                                |
| `backup-main.yml`              | push to `main`, monthly                    | Mirrors the repo to Azure DevOps / GitLab — opt-in by secrets; skips green when unset                                                                                                                                                |
| `scheduled-version-update.yml` | 1st and 15th                               | Stamps `.github/.version` with the current unix timestamp                                                                                                                                                                            |
| `upstream-sync.yml`            | weekly, manual                             | Dormant here (`if: github.event.repository.fork`); a fork of this repo points it at this repo                                                                                                                                        |

Secrets/variables and the branch-protection checklist live in `docs/DEPLOYMENT.md` (required settings) and are mirrored
in the workflow files themselves.

## Where this is going / out of scope

The session engine, the bridge (`POST /user/rpc`, `WS /user/updates`, the media routes `GET /user/file`,
`GET /user/avatar`, `POST /user/upload`, `POST /user/upload-group`), the Pages proxies, and the worker's Access JWT
verification are in place; what remains needs the owner. In order: (1) **M1 acceptance** — real QR login against the
account, one measured wake cycle — after `api_id`/`api_hash` exist; (2) the **72 h soak** at the 300 s cadence once the
deployment is up; (3) the
**`telegram-tt` fork** behind the existing bridge contract, once the Pages hostname is behind the Access application and
its `TEAM_DOMAIN`/`POLICY_AUD` are set. Both acceptance milestones run per `docs/SESSION_ENGINE.md`. Later concerns:
Secrets Store initialization, off-account DO storage backups (nothing to `d1 export`; the platform's
point-in-time recovery is the current answer), further coverage ratchets, end-to-end tests beyond the current seams, and
`@cloudflare/vitest-pool-workers` once real DO tests exist.

**Voice calls are in place, with one honest gap.** The signalling plane (`phone.*` over the bridge, the call
registry, the `call`/`call_signaling` updates, the socket relay), the call UX (the overlay, the ringtone, the
thread header's ☎) and the media plane (the browser-side Diffie-Hellman exchange, the documented packet envelope,
the WebRTC peer connection) are all implemented. A call **between two instances of this client** works. A call
**with Telegram's own clients does not yet**, for two reasons, both in `docs/SESSION_ENGINE.md` under _Milestone 4_:
the payload inside the encrypted signalling envelope is this client's own format (Telegram's native clients speak
tgcalls' message format, which is not publicly specified), and the byte order of the key fingerprint is ambiguous in
Telegram's documentation. Both need a real account to settle.

## Keeping AGENTS.md current

Update this file when a change moves a boundary: a new workspace package, a new workflow or secret, a changed
materialization path, a changed test partition, or a copied script diverging further from the kit. The file is the index;
the reasoning belongs beside the code it explains.
