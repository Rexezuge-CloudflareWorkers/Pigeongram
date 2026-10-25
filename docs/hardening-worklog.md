# Hardening Worklog

Living plan and progress log for the Pigeongram hardening pass. It carries the baseline measurements, the verified defect
list, the decisions taken with the owner, the planned refactors and the order they land in — so a later agent can continue
without re-running the analysis that produced it.

| Field           | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Status          | PR 1 (W1) complete — W2 coverage floor next                         |
| Branch          | `refactor/family-hardening` (work branches per PR, see §6)          |
| Baseline commit | `a67c5db` (merge of #100, `main`)                                   |
| Started         | 2026-10-25                                                          |
| Last updated    | 2026-10-25                                                          |
| Plan author     | OpenCode / `opencode/deepseek-v4.1-flash-free`                      |
| Owner decisions | Refuse a second call; slash commands extended to comments; flat 80% |

> **Layout note (2026-10-25, after #102).** The plan was written before the family workspace layout landed.
> `worker/` now lives in `packages/backend-services/`, `pages/` in `apps/web/`, and the shared contracts in
> `packages/shared/`. Paths in §2, §5 and Appendix A keep their original spelling so the baseline stays comparable;
> read them through this map. The PR order and the invariants are unchanged.

## 0. How to use this file

- **Read §4 before touching anything.** Those invariants are load-bearing and several of the planned refactors touch their
  edges.
- Work lands in the PR order of §6. Tick the checkboxes in §5 as items complete and append one line per PR to §9.
- Re-measure the baseline (§2) before starting: if it has drifted, update the numbers and note it in §9 rather than
  silently comparing against stale ones.
- Do not rewrite history in this file. Append; supersede with a dated note when a decision changes.
- The plan is allowed to be wrong. If a fix turns out to be a non-issue, mark it `dropped` with the reason instead of
  deleting the row — the reasoning is the value.

## 1. Objective

Harden the codebase without changing its architecture or deployment shape:

1. Fix correctness and resource-lifecycle bugs (microphone, audio contexts, sockets, call ordering, quota-sensitive
   writes).
2. Raise unit and integration coverage to a flat 80% on all four metrics, with tests concentrated on the modules that
   own those bugs.
3. Introduce the small number of design seams that make the untestable parts testable (RPC registry, bundle factory,
   engine deps, clock).
4. Remove dead code and give the god-file-adjacent modules headroom before the next feature lands.
5. Add the missing CI gate (coverage thresholds) and the missing local guard for worker bundling.

Breaking changes are allowed. New Cloudflare bindings are allowed but **not used** — see §3.4.

## 2. Baseline (measured at `a67c5db`)

### 2.1 Gates

`pnpm run checks` passed in full at the baseline: `typecheck`, `lint`, `format:check`, `check:god-files`,
`test:coverage`.

- 58 test files, 696 tests.
- `test/web/pages.test.tsx` is 3,989 lines and is the slowest file in the suite.
- God-file gate: 300 warn / 400 hard; only `worker/src/types.ts` and `pages/src/types.ts` are allowlisted.

### 2.2 Coverage

| Metric     | Covered / total | Percent |
| ---------- | --------------- | ------- |
| Lines      | 4,278 / 5,422   | 78.90%  |
| Statements | —               | 76.33%  |
| Branches   | 3,327 / 4,586   | 72.55%  |
| Functions  | —               | 78.27%  |

The 80% floor costs **+60 lines** and **+342 branches**. Branches are the whole difficulty; §5.2 breaks down where they
come from.

### 2.3 Inventory

- Worker ≈ 7,625 lines. Largest: `types.ts` 697 (allowlisted contract), `dto.ts` 383, `rpc.ts` 380, `rpc-types.ts` 377,
  `driver.ts` 362, `upload-spec.ts` 331, `lifecycle.ts` 312, `engine.ts` 270.
- SPA ≈ 15,106 lines. Largest: `types.ts` 816 (allowlisted contract), `App.tsx` 399, `api.ts` 393, `useComments.ts` 389,
  `links.ts` 388, `calls/controller.ts` 380, `useThread.ts` 371, `state.ts` 362.
- Import graph: no orphaned production modules. Entrypoints are only `worker/src/index.ts`, `pages/src/main.tsx`,
  `pages/sw/sw.ts`, `pages/build/pwa/plugin.ts`, `scripts/*`, and tests.
- No production source file is unreachable; the "dead code" found is dead **exports**, listed in Appendix B.

### 2.4 How the baseline was produced

```bash
pnpm run checks                                    # full gate, must be green before and after every PR
pnpm run test:coverage                             # writes coverage/lcov.info
# per-file extraction used for Appendix A:
node -e "…parse coverage/lcov.info…"               # any lcov parser is fine
```

The unused-export sweep was `grep -rn "<symbol>" worker/src pages/src test` for every `export` declaration, keeping only
symbols with no reference outside their defining file. Type-only contract exports were reviewed manually and excluded from
the actionable list (a `types.ts` export is the contract, not dead code).

## 3. Decisions

### 3.1 A second `startCall` is refused

- Guard `live.current` **before the first await** and take a `starting` ref, because `startCall` awaits the DH config,
  key generation and `requestCall` before it assigns `live.current`. A double-tap lands inside that window.
- Disable the ☎ in `ThreadHeader` while `calls.view` is non-null as a second line of defence.
- The guard path that is reachable reports through `onError` ("A call is already in progress"); the normal case is silent
  because the overlay is already up.

### 3.2 Slash commands: already wired; the remaining gap is the comments composer

The premise of the original question was wrong. The thread composer has the full feature already:

- `pages/src/components/Composer.tsx` — menu, prefix filter (`slashQuery`), ↑/↓/Tab/Enter/Escape, insertion at caret.
- `pages/src/useThread.ts:121` — reads commands in the same batch as the window
  (`fetchChatScreen(..., withCommands: supportsCommands(chat.kind))`).
- `pages/src/api.ts:218` — the batch adds `getBotCommands`.
- Tests: `test/web/composer.test.tsx` and `test/web/pages.test.tsx:924`.

What is dead is the standalone `pages/src/api.ts:285` `fetchBotCommands` export. What is missing is commands in the
**comments** composer (`pages/src/components/CommentsView.tsx:246` passes no `botCommands`).

The comments screen is a channel post's discussion thread. Telegram keeps the commands on the **discussion supergroup's**
bots, and the SPA never learns that peer's id. So "wire it" is a bridge change, not a one-line prop:

- **Option B (approved, separate PR):** extend `getBotCommands` to accept `messageId`, resolve the discussion peer
  server-side (consistent with "peers are resolved in the engine"), return `commands` in `GetCommentsResult`, pass them to
  the comments `Composer`.
- **Option A (fallback if B is dropped):** delete the dead export and leave the comments composer without commands.

Do **not** resolve the discussion peer in the SPA. Do not widen `supportsCommands` to `channel`: a channel's own
`botInfo` is not what the comments composer needs.

### 3.3 Coverage gate: flat 80% on all four metrics

No ratchet, no per-directory floors. One exception list, justified per entry:

| Exclusion            | Why                                                                                |
| -------------------- | ---------------------------------------------------------------------------------- |
| `pages/src/main.tsx` | 21 lines of React bootstrap (`createRoot`); nothing behaves, so nothing can assert |

`worker/src/session/mtproto/transport.ts` stays **in** coverage: §5.3 injects the `connectWs` seam so it becomes fakeable.
If the final branch figure stalls at 78–79%, add the tests; do not lower the gate or widen the exclusion list.

### 3.4 No new Cloudflare bindings

The hardening earns nothing from KV, D1, Queues, Workflows, AI or Secrets Store, and each adds a failure surface:

- The DO's SQLite is the storage; a KV cache binding is explicitly forbidden by the architecture (AGENTS.md).
- Background work already uses `state.waitUntil`; there is no fan-out that needs a Queue.
- The lifecycle is alarm-driven by design; a Workflow would duplicate it.
- Secrets are set with `wrangler secret`; Secrets Store stays the deferred concern AGENTS.md already names.

Revisit only if the product grows an off-account backup or push fan-out — neither is in this pass.

### 3.5 Branching and commits

- One branch per PR from §6, named `type/scope/description` (e.g. `fix/calls/lifecycle-guards`).
- Commit format per the house policy: `TYPE(scope): Title Case Description`, Markdown body, then
  `Harness: OpenCode` / `Model-ID: opencode/deepseek-v4.1-flash-free`.
- Author is `Rexezuge <79224316+Rexezuge@users.noreply.github.com>`.
- `pnpm run checks` must be green on every branch before it is pushed.

## 4. Invariants — do not break

These are copied from AGENTS.md where they constrain the work; read the originals before changing the surrounding code.

1. **One DO event at a time.** `batch` is the only mechanism for concurrency inside one event. Never add a write to the
   batch whitelist; never chain two reads that a batch could carry together.
2. **Free-plan write budget.** 100,000 rows/day, deletes count. No writes on read paths. `arm` skips a redundant
   `setAlarm`; `ensureArmed` repairs. Wake log, avatar cache and album ledger writes are best-effort. A quota failure must
   not fail a read, a login or a logout.
3. **Album counts as one unread.** The ledger (`unread-albums.ts`) is the machine; `DialogMessageDto.groupedId` is the SPA
   half. Do not derive unread from raw message counts anywhere.
4. **Media ranges are cut in the engine**, 1 MB-block aligned, never passed to mtcute as `limit`.
5. **Access gate.** `/user/*` verifies the JWT (RS256, issuer, audience, expiry) before the DO. Missing config → `503
{"code":"access_config"}`. `ACCESS_DEV_BYPASS` only outside production. No unauthenticated fallback, ever.
6. **The worker is reachable only through the `API_WORKER` service binding.** No `workers_dev`, no public route.
7. **The service worker never caches `/user/*` or `/api/*`**, and `/user/login` must always reach the edge.
8. **No `404.html`.** Deep links rely on the Pages SPA fallback.
9. **Optimistic sends stay out of server truth.** Never inject a pending message into `ChatThread.messages` or
   `DialogDto.lastMessage`.
10. **Calls:** DH and media stay in the page; the worker never sees the shared key; signalling rides the updates socket;
    the call overlay and the profile popup are not history layers.
11. **God files:** 400-line hard cap, `types.ts` only allowlisted. `App.tsx` is at 399 — do not add a line to it.
12. **DO migration `v1` is a one-way door.** This pass adds no storage and changes no class/binding names.
13. **`wrangler.jsonc` and `worker-configuration.d.ts` are generated** and never committed.

## 5. Workstreams

Priority: W1 → W2 → W3 → W4 → W5 → W6 → W7. W7 is optional and last on purpose.

### 5.1 W1 — Correctness and resource leaks (P0, ~1–1.5 days)

Every row was verified by reading the code at `a67c5db`; none is speculative.

- [x] **1.1** `pages/src/calls/webrtc.ts:104` — `openMicrophone()` can resolve after `close()`. The resolved stream is
      added to a closed `RTCPeerConnection` and never stopped: the microphone stays live and the tab keeps its recording
      indicator. **Fix:** `#closed` flag; after `getUserMedia` resolves, if closed, stop every track and return.
- [x] **1.2** `pages/src/calls/peer.ts:89` — same race one level up. `#peer` is assigned, then `await peer.openMicrophone()`
      runs, then orientation/offer proceeds even if `close()` ran during the await. **Fix:** re-check `#closed` after the
      await; `peer.close()` and return.
- [x] **1.3** `pages/src/calls/controller.ts:258` — `startCall` awaits three times before assigning `live.current`; a
      double-tap starts two calls and the second overwrites the first's session object. The first call is left ringing
      server-side and its peer object is orphaned. **Fix:** `starting` ref + `live.current` check before the first await;
      refuse per §3.1.
- [x] **1.4** `pages/src/calls/controller.ts:302` — `accept` has no in-flight guard. Two taps send two `acceptCall` RPCs
      with different `gB` values; the engine keeps the last while the first may already have been used, so the derived
      keys disagree. **Fix:** `accepting` ref; also guard on `current.keyPair`.
- [x] **1.5** `pages/src/calls/controller.ts:132,159` — `onActive`/`onAccepted` check `peer.ready`, but `establishKey` is
      async, so concurrent updates can both pass the check and derive/confirm twice. **Fix:** a `deriving`/`confirmed`
      flag set **before** the first await.
- [x] **1.6** `pages/src/hooks.ts:261` — server `{type:'error'}` frames are parsed and dropped. The engine broadcasts them
      for "Not signed in" and live-session failures, so the reader never learns the session is down. **Fix:** `onError`
      callback on `useUpdatesSocket`; surface through the app's existing error banner.
- [x] **1.7** `pages/src/hooks.ts:249` — backoff resets on `open`, not on `ready`. A socket that opens and immediately
      closes retries every 500 ms indefinitely, and each retry is a Worker request. **Fix:** reset on the first `ready`;
      add ±20% jitter.
- [x] **1.8** `pages/src/calls/ringtone.ts:30` — `stop()` suspends the `AudioContext` but never closes it; the getter
      creates one per instance and `CallOverlay` creates a `Ringtone` per call. Contexts accumulate to the browser's
      limit, after which audio breaks. **Fix:** `stop()` awaits `close()`, nulls the field; `#ring()` guards against a
      stopped instance.
- [x] **1.9** `pages/src/calls/webrtc.ts:84` — `event.streams[0]` is assumed present; some browsers deliver a track with
      an empty `streams` list. **Fix:** fall back to `new MediaStream([event.track])`.
- [x] **1.10** `pages/src/calls/peer.ts:187` — `#act` (and `receive`) can reject on malformed SDP/candidate, producing an
      unhandled rejection and a call that never reports failure. **Fix:** catch, report `onFailed`, close.
- [x] **1.11** `worker/src/session/engine.ts:55,223` — `writeMeta('me', …)` is not best-effort. With the write quota
      exhausted, a successful login throws from the callback and a logout answers 500 **after** the session is already
      destroyed. **Fix:** try/catch + warning on both. `readStoredMe` (`:262`) should warn on corrupt JSON and return
      null — do **not** delete the row (deletes are writes).
- [x] **1.12** `worker/src/session/lifecycle.ts:257` — `stopLive` awaits `catchUpTask` (up to `CATCH_UP_TIMEOUT_MS` = 25 s)
      even though its own comment says the replay settles on its own. The socket-close event holds the input gate for the
      whole replay. **Fix:** `Promise.race([catchUp, 2 s])`, then disconnect; the rest stays backgrounded. Make `stopLive`
      idempotent so a `webSocketError` + `webSocketClose` pair cannot tear down twice.
- [x] **1.13** `worker/src/session/params.ts:30`, `rpc.ts:59` — `requireRecord` coerces a non-object to `{}`, so
      `params: "garbage"` is silently accepted. **Fix:** strict record for dispatch (400); keep a lenient variant only
      where a handler genuinely accepts absent params.
- [x] **1.14** `worker/src/session/http.ts:14` — `readJsonBody` has no size cap; a large body is parsed inside the 10 ms
      CPU budget. **Fix:** stream-read with a 256 KB cap → 413 `payload_too_large`. RPC params are tiny by contract.
- [x] **1.15** `worker/src/session/socket-hub.ts:57` — socket frames are `JSON.parse`d before any length check. **Fix:**
      ignore text frames above 128 KB before parsing.

Regression tests for 1.1–1.15 ship in the same PR (§5.2), not later.

**Landed with PR 1:** `test/web/call-peer.test.ts`, `test/web/call-controller.test.tsx`, `test/web/ringtone.test.ts`,
`test/web/updates-socket.test.tsx`, `test/session/http.test.ts`, `test/session/lifecycle.test.ts` and
`test/session/socket-hub.test.ts`. The remaining W2 files (driver, RPC registry, mtproto crypto, config, the full engine
route table) wait for the W3 seams.

### 5.2 W2 — Tests and the 80% gate (P0, ~2.5–3.5 days)

New files, each named for the seam it needs:

| Test file                             | Covers                                                                                                                       | Seam needed                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `test/web/call-peer.test.ts`          | mic-after-close with a deferred `getUserMedia`, empty `event.streams`, malformed SDP, `drain()` order, `close()` idempotence | inject `RTCPeerConnection` + `mediaDevices` into `CallPeer` |
| `test/web/call-orchestrator.test.ts`  | double `startCall`, double `accept`, duplicate `accepted`/`active`, hang-up during the key exchange                          | W3 `CallOrchestrator` + fake peer                           |
| `test/web/ringtone.test.ts`           | start/stop closes the context, no ring after stop, one context per instance                                                  | inject `AudioContext` factory                               |
| `test/web/updates-socket.test.tsx`    | error frame surfaces, backoff after open/close churn, resync only on the second `ready`                                      | none                                                        |
| `test/session/driver.test.ts`         | connect/disconnect/destroy decision, `hasActiveCall`, upload/media delegation, update mapping                                | `MtBundleFactory`                                           |
| `test/session/lifecycle.test.ts`      | wake-log best effort, `ensureLive` dedupe, `stopLive` call guard, arm skip/repair, idle release                              | fake driver/hub/store/state + clock                         |
| `test/session/socket-hub.test.ts`     | ping/hello/unknown/bad JSON, broadcast fan-out, `waitUntil` relay, last-socket teardown                                      | fake `DurableObjectState`                                   |
| `test/session/rpc-registry.test.ts`   | every method classified, read-only set equals the batch whitelist, writes rejected by `batch`                                | W3 registry                                                 |
| `test/session/mtproto-crypto.test.ts` | SHA/random/deflate routes with `vi.mock('@mtcute/wasm')` and node's webcrypto                                                | mock only                                                   |
| `test/session/config.test.ts`         | env parsing table (wake interval, upload cap, media window)                                                                  | W5 config module                                            |
| extend `test/session/engine.test.ts`  | full route table incl. 404/405, quota-exhausted login/logout still succeed                                                   | W3 engine deps                                              |

Also: split `test/web/pages.test.tsx` along its existing `describe` blocks while touching it (it is the slowest file and
4k lines). No behavior change.

**Where the 342 branches come from** (target, measured against Appendix A):

| Source                                                                                                        | Available | Expected gain |
| ------------------------------------------------------------------------------------------------------------- | --------- | ------------- |
| 0–3% files (`calls/{exchange,peer,ringtone,controller,webrtc}`, `CallOverlay`)                                | 132       | ~120          |
| `driver`, `lifecycle`, `socket-hub`, `engine`, `call-rpc`                                                     | ~700      | ~150          |
| Error/plumbing partials (`rpc-errors`, `markup`, `upload`, `http`, `stats`)                                   | ~120      | ~45           |
| UI partials (`upload.ts`, `clipboard`, `MessageButtons`, `ProfilePopup`, `CommentsView`, `PendingMessageRow`) | ~140      | ~40           |
| **Total**                                                                                                     |           | **~355**      |

- [ ] Add `thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 }` in `vitest.config.mts`.
- [ ] Add the `pages/src/main.tsx` coverage exclusion (§3.3).
- [ ] Confirm `pnpm run test:coverage` fails when a threshold is missed (intentionally lower one, observe, restore).

### 5.3 W3 — Worker seams and the RPC registry (P1, ~3 days)

#### 5.3.1 RPC command registry (Command pattern)

Today method knowledge lives in four places: the `dispatchRpc` switch (`rpc.ts`), the parallel `dispatchCallRpc` switch
(`call-rpc.ts`), the `BatchableRpcMethod` union, and the `BATCHABLE_METHODS` set (`params.ts`). Replace with one table:

```ts
interface MethodSpec {
  readOnly: boolean;
  run(ctx: DispatchContext, params: unknown): Promise<unknown>;
}

export const RPC_METHODS: { readonly [M in RpcMethod]: MethodSpec } = {
  // one entry per method; call.* entries live here too
};
```

- The mapped type over `RpcMethod` makes adding a method to the contract a **compile error** until it is classified.
- `BATCHABLE_METHODS` becomes `filter(readOnly)`, assigned to `readonly BatchableRpcMethod[]` so the two unions cannot
  drift in either direction.
- `call.*` becomes ordinary entries with `readOnly: false`; the `callResult !== null` special case disappears.
- Per-domain handler modules (`rpc-dialogs.ts`, `rpc-messages.ts`, `rpc-media.ts`) fall out of the split, taking `rpc.ts`
  from 380 lines to a dispatcher.
- Keep the batch behavior identical: per-call failures reported per call, no writes, no `readHistory`.

#### 5.3.2 Dependency seams (ports and adapters, kept small)

- `TelegramDriver(env, storage, createBundle = createMtBundle)` — unlocks `driver.test.ts` without wasm or a network.
- `SessionEngine` accepts an optional `EngineDeps` (`driver`, `store`, `avatars`, `now`) defaulting to today's
  construction — unlocks route tests and makes quota failures injectable.
- `now: () => number` on lifecycle/avatar cache — deterministic alarm cadence and TTL tests.
- `WorkersWsTransport(…, connect = connectWs)` — keeps `transport.ts` in coverage with a fake connection.
- `CallPeer` takes a `RTCPeerConnection` factory + `mediaDevices`; `Ringtone` takes an `AudioContext` factory.

No container, no service locator. Two defaulted parameters per boundary is the house style.

#### 5.3.3 `CallOrchestrator` class

Extract everything in `pages/src/calls/controller.ts` that is not React: the live-call record, the guard flags, the key
exchange, the confirm/accept ordering. It takes ports (`rpc`, `send`, `createPeer`, `now`) and exposes
`start/accept/decline/hangUp/handleUpdate`. `useCalls` becomes a ~100-line adapter over `useReducer`. This is the OO
change with the clearest payoff: the ordering rules become unit-testable and the hook stops being a 380-line async state
machine. `calls/session.ts` (the reducer) stays as-is — it is already tested.

#### 5.3.4 `useAnchoredMenu` hook

`MessageMenu`, `ThreadHeader` (`⋮`) and `UserMenu` each reimplement portal + measure + clamp + focus-first + restore-focus

- Escape + outside-scroll-close. Extract once, **after** the context-menu tests exist, and prove parity with them.

### 5.4 W4 — Readability and god-file headroom (P1, ~1 day)

Three files are at or near the hard cap, so the next feature cannot land without a split:

| File                            | Lines | Split                                                                                                    |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `pages/src/App.tsx`             | 399   | signed-in shell + sidebar wiring → `components/SignedInShell.tsx`; `App` keeps routing/state composition |
| `pages/src/api.ts`              | 393   | `api/request.ts` + `api-chats.ts` + `api-threads.ts` + `api-uploads.ts`, re-exported from `api.ts`       |
| `pages/src/useComments.ts`      | 389   | `useCommentsSend` (send/attach/react/forward) + `useCommentsUpdates` (live fold)                         |
| `pages/src/calls/controller.ts` | 380   | shrinks to the adapter in §5.3.3                                                                         |
| `worker/src/session/rpc.ts`     | 380   | registry split in §5.3.1                                                                                 |

- [ ] Delete `pages/src/outbox.ts:189` `pendingForThread` (no references).
- [ ] Delete or wire `pages/src/api.ts:285` `fetchBotCommands` (see §3.2 / W7).
- [ ] Unexport `ACCESS_LOGIN_PATH`, `rpcBatch`, `ChatScreen` — all are module-internal.
- [ ] Add a "no speculative exports" line to AGENTS.md rather than adding `knip` (it false-positives on the mirrored
      contract modules).

### 5.5 W5 — Config, error taxonomy, logging (P2, ~1 day)

- [ ] `worker/src/session/config.ts`: parse `WAKE_INTERVAL_SECONDS`, `UPLOAD_MAX_BYTES`, media window sizes once into a
      typed object. Today the bounds logic is duplicated between `lifecycle.wakeIntervalMs`, `engine` and the upload
      parsers.
- [ ] `EngineError` gets an optional `code` (`validation`, `not_found`, `conflict`, `access`, `storage_write_quota`, …).
      The SPA's `ApiError.code` already exists and is almost never populated, so nothing can distinguish retryable from
      terminal failures. Additive to the JSON shape.
- [ ] `worker/src/session/log.ts`: `log.info/warn/error(event, fields)` emitting one structured line. Today `console.*`
      calls are ad hoc; structured fields are queryable in Workers Logs and assertable in tests without matching prose.

### 5.6 W6 — CI guardrails (P2, ~0.5 day)

- [ ] Coverage thresholds from §5.2 (the main gate).
- [ ] `wrangler deploy --dry-run` on PRs touching `worker/` or the wasm import path. CD already runs it before deploying;
      a PR that breaks bundling currently finds out only after merge. Needs no secrets (materialize the config in the
      job).
- [ ] Keep the test partitions unchanged: `test/web/**` = SPA (jsdom), everything else under `node`, `test/pwa/**` under
      `node`.

Explicit non-goal: `@cloudflare/vitest-pool-workers`. It is the right long-term answer for real DO/WebSocket integration
(`socket-hub.accept` in particular), but it is a tooling migration, not a hardening PR.

### 5.7 W7 — Comments slash commands (optional, ~0.5 day)

Only if §3.2 option B survives. Contract change:

1. `getBotCommands` accepts `{ chatId, messageId? }`; with `messageId`, resolve the post's discussion peer in the engine
   and read its `botInfo`.
2. `GetCommentsResult` gains `commands: BotCommandDto[]` (additive).
3. `useComments` passes them to `CommentsView` → `Composer`.
4. Tests: engine resolution (channel post → discussion → commands), SPA menu opens in the comments composer.
5. Mirror `worker/src/types.ts` and `pages/src/types.ts` by hand.

If B is dropped: delete `fetchBotCommands` and close the item with a note.

## 6. Sequencing

| PR  | Branch (suggested)               | Contents                                                     | Gate                                     |
| --- | -------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| 1   | `fix/calls/lifecycle-guards`     | W1 fixes + regression tests                                  | `pnpm run checks`                        |
| 2   | `test/hardening/coverage-floor`  | W2 remaining tests + 80% thresholds + `main.tsx` exclusion   | `pnpm run checks`; threshold sanity test |
| 3   | `refactor/worker/rpc-registry`   | §5.3.1 + §5.3.2 seams                                        | `pnpm run checks` + dry-run              |
| 4   | `refactor/web/call-orchestrator` | §5.3.3 + §5.3.4                                              | `pnpm run checks`                        |
| 5   | `refactor/web/god-file-headroom` | W4 splits + dead exports + W5 config/logging + W6 dry-run CI | `pnpm run checks` + dry-run              |
| 6   | `feat/web/comments-commands`     | W7 (optional)                                                | `pnpm run checks`                        |

Rules for every PR:

1. Characterization tests before the refactor, in the same PR.
2. No behavior change in a `refactor/*` PR beyond the listed item; a drive-by fix gets its own commit and its own note.
3. `pnpm run checks` green, and `pnpm exec tsc -p worker/tsconfig.json --noEmit` equivalent is covered by `typecheck`.
4. Update §9 here, tick §5 boxes, and bump the Status line.
5. Never merge with a red dry-run.

## 7. Verification

```bash
pnpm run checks:fast     # typecheck + lint + format + god-files, fast loop
pnpm run test:coverage   # must be >= 80/80/80/80
pnpm run checks          # the full gate; the only definition of green
```

Worker-touching branches additionally:

```bash
cp .dev.vars.example .dev.vars            # if absent; never commit
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler deploy --dry-run       # the wasm/bundle gate
```

Manual smoke (after W1, unchanged expectations otherwise): attach a tab, place a call, confirm the ringtone stops and the
microphone indicator goes out on hang-up; drop the socket and confirm the reconnect's resync; open a bot chat and confirm
the slash menu still completes.

## 8. Risks and open items

| Risk                                                              | Mitigation                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Branch coverage stalls below 80% after W2                         | Add the focused tests listed in §5.2; only §3.3's `main.tsx` exclusion is permitted         |
| `stopLive` racing disconnect if the catch-up await is shortened   | Bound the wait (2 s) rather than removing it; keep the disconnect in `stopLive`             |
| Call guards reject a legitimate retry (user hangs up, redials)    | Guards are per-call-instance and cleared by `teardown`; test the redial path explicitly     |
| `CallOrchestrator` extraction drifts from the reducer's semantics | `session.ts` is unchanged and already tested; adapter tests pin the mapping                 |
| `useAnchoredMenu` changes focus behavior                          | Land after the context-menu tests; run them unchanged                                       |
| The registry refactor accidentally widens the batch whitelist     | Exhaustiveness type + `rpc-registry.test.ts` asserts the derived set equals the literal one |
| W7 contract change collides with a mirrored `types.ts` edit       | Separate PR, mirror both files in one commit, typecheck the SPA against the new field       |
| Free-plan quota tests are flaky if they depend on real errors     | Inject a store/driver that throws the quota error; never exhaust a real budget in tests     |

Open questions (none blocking PR 1):

- Should `getBotCommands` gain `messageId` (W7 B), or is the thread menu enough (A)? Default: B, droppable.
- Should `fetchBotCommands` survive as an exported API for future screens? Default: no — the batch covers it.

## 9. Progress log

Append one entry per landed PR. Keep it terse: date · branch/commit · what changed · gate result · notes.

| Date       | Ref                         | What                                                                                                                                                                                                                         | Gate                    |
| ---------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 2026-10-25 | `a67c5db`                   | Baseline: full analysis, defects verified, coverage measured                                                                                                                                                                 | `pnpm run checks` green |
| 2026-10-25 | `docs/hardening-worklog`    | This worklog; decisions recorded                                                                                                                                                                                             | `format:check` + review |
| 2026-10-25 | `refactor/family-hardening` | W1 1.1–1.15 fixed; regression tests added; call button disabled while a call is up. Coverage re-measured after the layout move: **lines 83.68%, statements 80.71%, branches 75.13%, functions 81.10%** (65 files, 807 tests) | `pnpm run checks` green |

Template:

```md
| YYYY-MM-DD | `type/scope/short` (`abc1234`) | One sentence on the change | `pnpm run checks` green; coverage X/Y |
```

## Appendix A — coverage gaps at baseline (< 85% lines)

Worker (paths relative to `worker/src/session/`):

| File                   | Lines | Branches | Missed branches |
| ---------------------- | ----- | -------- | --------------- |
| `mtproto/crypto.ts`    | 12.0% | 0.0%     | 6               |
| `mtproto/platform.ts`  | 20.0% | 0.0%     | 8               |
| `mtproto/transport.ts` | 20.0% | 11.1%    | 8               |
| `driver.ts`            | 23.7% | 8.3%     | 33              |
| `call-rpc.ts`          | 27.7% | 47.6%    | 11              |
| `socket-hub.ts`        | 52.8% | 35.3%    | 11              |
| `engine.ts`            | 60.6% | 63.9%    | 13              |
| `rpc-errors.ts`        | 64.7% | 50.0%    | 11              |
| `lifecycle.ts`         | 66.3% | 47.7%    | 23              |
| `markup.ts`            | 75.9% | 55.6%    | 12              |
| `upload.ts`            | 76.0% | 57.4%    | 23              |
| `http.ts`              | 76.9% | 50.0%    | 4               |
| `stats.ts`             | 81.8% | 63.6%    | 8               |
| `avatar-cache.ts`      | 83.3% | 64.3%    | 5               |
| `call-dto.ts`          | 83.9% | 84.6%    | 6               |
| `call-params.ts`       | 84.2% | 88.2%    | 6               |

SPA (paths relative to `pages/src/`):

| File                               | Lines | Branches | Missed branches |
| ---------------------------------- | ----- | -------- | --------------- |
| `main.tsx`                         | 0.0%  | n/a      | 0 (excluded)    |
| `calls/exchange.ts`                | 0.0%  | 0.0%     | 10              |
| `calls/peer.ts`                    | 0.0%  | 0.0%     | 48              |
| `calls/ringtone.ts`                | 0.0%  | 0.0%     | 14              |
| `components/CallOverlay.tsx`       | 2.5%  | 0.0%     | 46              |
| `calls/webrtc.ts`                  | 19.6% | 33.3%    | 16              |
| `calls/controller.ts`              | 19.8% | 3.1%     | 62              |
| `upload.ts`                        | 47.4% | 68.9%    | 19              |
| `clipboard.ts`                     | 51.7% | 64.3%    | 5               |
| `components/Avatar.tsx`            | 61.1% | 82.6%    | 4               |
| `components/MessageButtons.tsx`    | 62.5% | 65.1%    | 15              |
| `useCommentsPoll.ts`               | 63.6% | 25.0%    | 3               |
| `upload-api.ts`                    | 64.7% | 34.5%    | 19              |
| `components/PendingMessageRow.tsx` | 65.0% | 53.7%    | 19              |
| `components/ProfilePopup.tsx`      | 67.5% | 53.8%    | 24              |
| `useComments.ts`                   | 67.9% | 49.4%    | 45              |
| `components/ConfirmDialog.tsx`     | 69.2% | 42.1%    | 22              |
| `components/MediaViewer.tsx`       | 71.4% | 59.7%    | 29              |
| `outbox.ts`                        | 72.7% | 54.5%    | 10              |
| `photo-zoom.ts`                    | 75.0% | 40.0%    | 18              |
| `components/Poll.tsx`              | 75.0% | 68.1%    | 22              |
| `components/UploadDialog.tsx`      | 75.0% | 55.2%    | 30              |
| `hooks.ts`                         | 76.7% | 60.8%    | 20              |
| `components/Media.tsx`             | 78.6% | 52.8%    | 25              |
| `useRouter.ts`                     | 79.6% | 70.8%    | 19              |
| `useProfile.ts`                    | 80.0% | 65.4%    | 9               |
| `components/ThreadHeader.tsx`      | 80.5% | 72.4%    | 16              |
| `components/LoginScreen.tsx`       | 81.5% | 70.4%    | 21              |
| `components/ForwardPicker.tsx`     | 83.0% | 61.5%    | 15              |
| `pwa/register.ts`                  | 83.3% | 83.3%    | 1               |
| `components/CommentsView.tsx`      | 83.7% | 91.4%    | 6               |
| `calls/dh.ts`                      | 84.3% | 55.8%    | 23              |

## Appendix B — actioned dead exports

| Symbol              | Location                  | Finding                                                         | Action         |
| ------------------- | ------------------------- | --------------------------------------------------------------- | -------------- |
| `fetchBotCommands`  | `pages/src/api.ts:285`    | No references; the batch path (`fetchChatScreen`) supersedes it | Delete (or W7) |
| `pendingForThread`  | `pages/src/outbox.ts:189` | No references                                                   | Delete         |
| `ACCESS_LOGIN_PATH` | `pages/src/api.ts:40`     | Used only by `accessLoginUrl` in the same module                | Unexport       |
| `rpcBatch`          | `pages/src/api.ts:130`    | Used only inside `api.ts`                                       | Unexport       |
| `ChatScreen`        | `pages/src/api.ts:175`    | Return type of `fetchChatScreen` only                           | Unexport       |

The broader sweep found ~146 unreferenced exports, almost all type-only members of the mirrored contract modules
(`types.ts`, `rpc-types.ts`, `call-types.ts`). Those are not dead code; do not delete them.

## Appendix C — conventions worth knowing before editing

- **Error bodies:** `EngineError` → `{error}` with its status; `EngineConfigError` → 503; quota →
  `503 {"code":"storage_write_quota","error":…}`; unexpected → 500 `{error: message}`. W5 adds `code` additively.
- **RPC params:** validated in `params.ts` / `call-params.ts`; every validator throws `EngineError(…, 400)`. The bridge
  never forwards raw MTProto.
- **Batch:** read-only methods only, max 8, per-call outcomes. Adding a method means classifying it in the registry
  (W3) — the type will force it.
- **Media:** `GET /user/file` and `/user/avatar` are Access-gated by the same-origin cookie; byte windows are cut in
  `media-stream.ts`; never pass browser ranges to mtcute.
- **Uploads:** `POST /user/upload` carries the raw body, validated twice (edge + engine); albums are one body split by
  `UploadBodySplitter`, streams use `highWaterMark: 0`.
- **Tests:** `test/web/**` is jsdom, everything else `node`; the SPA's fakes live at the top of `pages.test.tsx`
  (`FakeWebSocket`, fetch stubs) — reuse them rather than inventing a second harness.
- **God files:** `App.tsx` is at 399 lines. A one-line addition fails the gate; do the split first.
- **Docs:** `docs/session-engine.md` is the engine runbook; `docs/pwa.md` and `docs/android.md` cover the other planes.
  This file is the only work log.
