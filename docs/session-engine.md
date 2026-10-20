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
- **Chunked crypto, not buffered payloads.** `/api/file`, `/api/avatar` and `/api/upload` stream; uploads are
  chunked and encrypted (AES-IGE) part by part on mtcute's upload pool. Upload CPU grows with the file size, so
  `UPLOAD_MAX_BYTES` is also the CPU-affordability knob — lower it if large uploads exhaust the budget.
- **WASM crypto.** SHA-1/IGE/gzip come from `@mtcute/wasm` (57 KB), imported as a `CompiledWasm` module and
  instantiated synchronously; the JS crypto is only for the random pool and 2FA (`crypto.subtle`).
- **Small bundle.** mtcute core is ~470 KB gzip in the worker bundle; the 3 MiB Free limit has plenty of room.
- **Bounded storage.** The DO's SQLite is the only storage (no D1, no R2). `GET /api/stats` reports
  `databaseBytes` so growth is visible in the soak.

## Bridge API

All routes live under `/api/*` on the worker; the Pages Function forwards them verbatim. Every `/api/*` request is
gated by Cloudflare Access: the worker verifies the `Cf-Access-Jwt-Assertion` application token (signature, issuer,
audience and expiry) before forwarding to the `SessionEngine`. The Access application's policy is the allowlist; the
worker does not inspect the token's email. Unless noted, responses are JSON, errors are `{"error": string}` with a
4xx/5xx status, and a misconfigured deployment answers `503` with the engine's configuration message.

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
| `GET /api/file`            | `?chatId=&messageId=&thumb=1` + `Range` | media bytes (see below)                                    |
| `GET /api/avatar`          | `?chatId=&size=small\|big`              | profile photo bytes (`image/jpeg`, cached a day)           |
| `POST /api/upload`         | query params + raw body (see below)     | `{"message": MessageDto}`; sends one file                  |
| `POST /api/wake`           | —                                       | `WakeCountersDto`; runs one wake cycle now                 |
| `GET /api/stats`           | `?days=1..30` (default 7)               | `StatsDto` (`counters`, per-day buckets, `databaseBytes`)  |

`GET /health` lives on the worker, not the engine, and is never gated; it carries no account data.

### Media routes

`GET /api/file` serves every downloadable kind (photo/video/audio/voice/sticker/document) with the right content
type, resolved fresh from the message on each request — no file location or `file_reference` ever reaches the
browser. `thumb=1` answers with the best thumbnail instead (video posters). Videos and documents are served with
`accept-ranges`/`content-range` so `<video>` seeking works; the engine owns each byte window
(`session/media-stream.ts`): it requests from a 1 MB-block-aligned offset (mtcute's non-precise parts must not
straddle a 1 MB boundary), drops the extra prefix bytes, cuts the tail at the requested end and applies backpressure
(one chunk buffered), so a slow player never pulls the file into the isolate. Browser ranges are never forwarded to
mtcute as `limit`: it accepts only whole-file sizes and throws after the response headers have already gone out —
which is what used to kill playback after the first buffered seconds.

`GET /api/avatar` resolves the peer's photo server-side. The DTOs carry an opaque `photo` token
(`ChatPhoto.uniqueFileId`) purely to bust the browser cache; the SPA appends it to the URL as `v=`.

`POST /api/upload` takes the file as the **raw request body** (no multipart); everything else rides the query
string: `chatId`, `kind` (`photo` | `video` | `animation` | `document`), `size` (required; must match
`content-length` when set), `fileName`, `mime`, `caption`, `replyTo` (a message id in the same chat), and
optional `width`/`height`/`duration`. `commentTo` (a channel post id) turns the upload into a comment on that
post: it is sent to the linked discussion group, and `replyTo` then names a comment inside the thread instead
of a message in `chatId`. The body is streamed through the DO into mtcute's upload connection pool, so nothing
buffers in the isolate, and `UPLOAD_MAX_BYTES` (wrangler var, default 100 MB) rejects oversized requests with a
413 before Telegram is touched. The query is parsed once more at the edge with the same parser, so a rejected
upload never reaches the DO at all — workerd reads a request stream after its response when a Durable Object
answers without consuming the body (cloudflare/workerd#918). The kind is never guessed server-side: the SPA converts non-JPEG
canvas-decodable images to JPEG (what official clients do) and falls back to `document` for anything else.

### RPC methods

| Method                | Params                                                                 | Returns                                                                                     |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `getMe`               | —                                                                      | `{me}`                                                                                      |
| `getDialogs`          | `{limit?: 1..200}`                                                     | `{dialogs: DialogDto[]}` (pinned first)                                                     |
| `getHistory`          | `{chatId, limit?: 1..100, offsetId?, offsetDate?, addOffset?: -50..0}` | `{messages: MessageDto[]}` (oldest first; the oldest album at the window edge is completed) |
| `sendMessage`         | `{chatId, text, replyTo?}`                                             | `{message}`                                                                                 |
| `readHistory`         | `{chatId, maxId?}`                                                     | `{}`                                                                                        |
| `searchMessages`      | `{chatId, query, limit?, offsetId?}`                                   | `{messages, nextOffsetId?}`                                                                 |
| `sendReaction`        | `{chatId, messageId, emoji?\|customEmojiId?}`                          | `{message: MessageDto \| null}`                                                             |
| `sendVote`            | `{chatId, messageId, options: number[] \| null}`                       | `{poll}`                                                                                    |
| `pressCallbackButton` | `{chatId, messageId, data}`                                            | `{text: string \| null, alert: boolean, url: string \| null}`                               |
| `getPollResults`      | `{chatId, messageId}`                                                  | `{poll}`                                                                                    |
| `getComments`         | `{chatId, messageId, limit?: 1..100, offsetId?, offsetDate?}`          | `{comments, count, discussionChatId, discussionMessageId, nextOffsetId?, nextOffsetDate?}`  |
| `sendComment`         | `{chatId, messageId, text, replyTo?}`                                  | `{message}`                                                                                 |
| `getBotCommands`      | `{chatId}`                                                             | `{commands: BotCommandDto[]}`                                                               |

`chatId` is always a **marked** peer id: users positive, basic groups `-id`, channels/supergroups `-100…`.
The client never sends raw MTProto; the engine resolves peers server-side.

`getBotCommands` reads the slash-command menu Telegram associates with a chat. Commands are not part of the
dialog peer, so the engine looks at the full info instead: a user (`users.getFullUser`) carries one
`botInfo.commands` for a bot's private chat, while a group or supergroup (`messages.getFullChat`) carries one
`botInfo` per bot. The bridge flattens the group list, de-duplicates command names and returns
`{command, description}` in Telegram's order; an empty list is a normal answer, not an error. The SPA asks for
this when a bot, group or supergroup thread opens and offers the menu from the composer.

`DialogDto` carries the chat, its `lastMessage`, `unread` and `readInboxMaxId` (the read watermark: the
last read incoming message), plus `pinned`/`muted`. The SPA opens a chat at the first incoming message after
the watermark instead of the bottom, and `readHistory`'s optional `maxId` reports how far the user actually
scrolled (omitted, it reads the whole history — the comments screen's behavior).

`MessageDto` carries rich text alongside the plain `text`: `entities` (UTF-16 spans — bold/italic/spoiler/
code blocks, `text_link`/`url`/`mention` links) and `reactions` (emoji aggregates, each with its `count` and
a `chosen` flag for the current user). `sendReaction` sets the caller's reaction (`emoji` for unicode, or
`customEmojiId` for a custom emoji document), or removes it when both are null/omitted. Channel posts also
carry `views` (`null` for every other message), so the thread renders the counter beside the timestamp and
keeps it ticking from the live `views` update while the post is loaded.

Service messages carry no text of their own (`mtcute` deliberately returns an empty string), so the bridge
fills `text` with the English label the UI renders — currently the auto-delete timer change, including the
disabled and channel variants. Other actions keep their empty text until they get a label of their own.

A poll message carries `poll` beside `media` — Telegram's `messageMediaPoll` has no file, so it never shows up in
`media`. `MessagePollDto` holds the question, the answers in Telegram's order and the flags the UI needs (`quiz`,
`multiple`, `revotingDisabled`, `hideResultsUntilClose`, `closed`, `solution`); `id` is the decimal poll id the
updates name it by. Per-answer `voters`/`correct` and `totalVoters` stay `null` when Telegram did not share the
results with the poll — a quiz before this account answers, or one that hides them until it closes — and `null`
keeps "unknown" apart from zero voters. `sendVote` therefore takes answer **indexes** against the live message
(Telegram caps a poll at ten answers) rather than raw option bytes: the engine resolves them server-side, so a
stale list can never send a wrong answer's bytes. `null`/omitted `options` retracts the vote. The comments screen
votes through the same RPCs, including polls on the pinned channel post and on comments in the discussion group.

A message's inline keyboard arrives as `markup`: Telegram's rows of `MessageButtonDto`, each with its `text`, optional
`style` and a discriminated `kind`. Callback buttons carry their opaque payload as base64 `data` (JSON has no byte
string), URL/web-view buttons carry what they open, and copy buttons carry the text they place on the clipboard. The
remaining kinds (games, payments, URL authorization, inline-mode switches, user profiles, password-protected
callbacks, buttons Telegram already disabled) are carried so the SPA can show them visibly disabled instead of
dropping them. `pressCallbackButton` decodes `data` (at most Telegram's 64 bytes) and forwards the press through
`messages.getBotCallbackAnswer`; its result tells the SPA what the bot answered (`text`), whether it asked for an alert
rather than a toast, and whether it asked to open a `url`. Bots can remove or replace a keyboard with `edit_message`,
which already replaces the whole message DTO, so no extra update type is needed.

`groupedId` marks album membership: Telegram delivers one album as several messages that share that id, and
the SPA renders them as one bubble while every message stays addressable for reactions, replies and read
receipts. Telegram stores album reactions on the first message, so the UI exposes that one; `getHistory`
pulls in the older members of a window's oldest album so a page never splits one.

`getHistory`'s `addOffset` skips that many messages from `offsetId` (negative is towards newer), which is how a
`t.me` post link opens a window _around_ the linked post instead of the newest messages; `offsetId` alone is
accepted (the link names the post but not its date, so the omitted date reads as 0).

A message that replies to another carries `reply`: where the original lives (`origin`), its `messageId`/`chatId`
when known, `senderName`/`date`, explicit quote `text`/`entities`, `mediaKind`, and the `quote` flag. Same-chat
headers carry only the message id, so the SPA resolves the quote's sender and snippet from the thread it already
has; `sendMessage` takes `replyTo` (a message id in the same chat) to send one.

A forwarded message carries `forward`: the origin's `senderId`/`senderName` (a hidden forward's name instead of an
id), the original's `date`, the original chat/message for saved-messages forwards and channel posts
(`fromChatId`/`fromMessageId`), and the post `signature` when the header has one. `worker/src/session/dto.ts` maps
it from Telegram's forward header, and the bubble renders a "Forwarded from …" line above the sender name.

### Channel-post comments

A channel post's `comments` field (`hasComments`, `count`, `discussionChatId`) comes from Telegram's `replies`
header — the pointer into the channel's linked discussion group. Comments themselves live in that group: the
post is mirrored there as a root message and every comment replies into its thread.

`getComments` resolves the group with `messages.getDiscussionMessage` and reads one window of the thread with
`messages.getReplies` (oldest first, newest window unless a cursor is passed); the root message is dropped and
the cursor is the oldest comment of the window. `discussionChatId`/`discussionMessageId` are null while the
thread does not exist yet, and the pre-thread `FLOOD_WAIT` Telegram answers the lookup with is read as "no
thread yet". `sendComment` posts through mtcute's `commentText`/`commentMedia` for a top-level comment (which
also covers the first comment, when Telegram still has to create the thread) and resolves the group itself for
a reply, so `replyTo` names a comment in the thread. Reads never require membership in the group; posting
requires it, and Telegram's error surfaces to the SPA verbatim.

Reactions on comments target the group and arrive live, and the SPA merges them into the open screen by
matching the update's chat id and reply header against the thread. Reply counts on the post are only as fresh
as the last load plus the caller's own sends: this TL layer has no reply-count update, so a comment from
someone else does not bump the button until the channel thread reloads.

### Updates socket protocol

Client → server: `{"type":"hello"}` (attach; engine goes live) and `{"type":"ping"}` (25 s keepalive).
Server → client: `{"type":"ready"}`, `{"type":"pong"}`, `{"type":"error","message":…}`, and
`{"type":"update","update":{"type":"new_message"|"edit_message"|"reactions"|"views"|"poll"|"read", …}}`.
The `reactions` update carries `{chatId, messageId, reactions}` (no full message) whenever anyone reacts.
The `views` update carries `{chatId, messageId, views}` (again no full message), mapped from Telegram's
`updateChannelMessageViews`, so a channel post's counter ticks live for as long as the thread is loaded.
The `poll` update carries `{chatId, messageId, pollId, poll}`: `pollId` is what identifies the poll both for the
short `updateMessagePoll` (no body) and for `updateMessagePollVote`, which names the poll but neither its chat nor
its message. A null `poll` means "recheck this one": the SPA calls `getPollResults` for the loaded message and folds
the answer in, so results stay live without the engine holding per-poll state. `sendVote` answers with the same DTO,
so the caller's own vote renders without waiting for the socket.
The `read` update carries `{chatId, maxId, unread, inbox}`: `inbox` distinguishes the account's own inbox
from the peer reading the account's messages, and only inbox reads move `unread` and `readInboxMaxId`.

## Local development

```bash
cp .dev.vars.example .dev.vars        # fill in api_id/api_hash
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler dev                # worker on :8787
pnpm --filter @telegram-web-client/pages dev   # SPA on :5173, /api proxied
```

Local development does not pass through Cloudflare Access. The example `.dev.vars` sets
`ENVIRONMENT="development"` and `ACCESS_DEV_BYPASS="true"`; the worker skips JWT verification only outside
production and fails closed if the bypass is ever present with `ENVIRONMENT="production"`. Never set the bypass on a
deployment.

Smoke checks (no Telegram credentials needed for the first two):

```bash
curl -s localhost:8787/health
curl -s localhost:8787/api/state                                      # → phase "unauthorized"
```

With credentials in `.dev.vars`, open the SPA and scan the QR code from Telegram
(Settings → Devices → Link Desktop Device).

Both sign-in paths are available in the SPA: the QR code (primary) and, behind "Use a phone number instead",
the phone-number path (`sendCode` → code → optional 2FA). The phone path exists because a login code is valid
for minutes rather than the QR token's ~30 seconds, and because it needs no camera — Telegram delivers the code
to your own app. `phase` reports the path: `qr`/`scanned` for the QR, `code` while a code is awaited
(`codeType` says how it was delivered, `codeInvalid` after a rejected one).

## Milestone 1 — spike acceptance

1. `pnpm exec wrangler deploy --dry-run` is clean (also verifies the wasm import).
2. Deploy (`wrangler deploy` + secrets + the Access vars), then `GET /health` and `GET /api/state` through Cloudflare
   Access. A service token is the clean way to script the calls:
   `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://<pages-host>/api/state`.
3. `POST /api/wake` answers with `totalWakes: 1, failedWakes: 0` and the DO returns to sleep; verify with
   `GET /api/stats` that `avgWakeMs` fits the plan's limits and `lastWakeAt` is recent.
4. QR login completes end-to-end: `phase` walks `qr → scanned → (password) → authorized`, and `me` is populated.
5. A message sent to the account from another device appears in the SPA within a wake interval or immediately while
   a tab is open (live mode); sends and reads round-trip, a photo/video upload lands in the thread and as the chat
   preview, and avatars render in the chat list, thread header and sidebar.
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
```

The worker verifies Cloudflare Access on `/api/*`, so the deployment also needs both verifier vars — through
`WRANGLER_VARS_PATCH_JSON` in CD or the dashboard:

```json
{ "TEAM_DOMAIN": "https://<team>.cloudflareaccess.com", "POLICY_AUD": "<application-aud-tag>" }
```

Missing or malformed values make `/api/*` answer `503 {"code":"access_config"}`; there is no unauthenticated
fallback. Set them before deploying this change.

Pending owner actions (one-time):

1. `api_id` / `api_hash` from my.telegram.org (the QR login needs them).
2. Attach the production domain to the **Pages** project, issue the certificate, then put a self-hosted Cloudflare
   Access application (with an allow policy for the owner) in front of the public hostname. Do not use an Access
   application targeting the worker: Worker-destination Access rejects WebSocket upgrades. Copy its AUD tag and the
   team domain into the verifier vars above.
3. Optionally create an Access **service token** for scripted checks (`/api/stats` during the soak), and add a
   Service Auth policy to the application.

## Troubleshooting

| Symptom                                                          | Cause                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/*` → `401 {"code":"access"}`                               | The request reached the worker without a valid `Cf-Access-Jwt-Assertion`: the hostname is not behind Access, the Access session expired, or a service-binding call skipped it. Reload through the Pages hostname |
| `/api/*` → `503 {"code":"access_config"}`                        | `TEAM_DOMAIN`/`POLICY_AUD` are missing or malformed, or `ACCESS_DEV_BYPASS` is set with `ENVIRONMENT="production"`                                                                                               |
| `/api/*` → `503` "TELEGRAM_API_ID…"                              | Secrets are missing on the deployment (the engine reports the configuration error)                                                                                                                               |
| `/api/*` → `503` "Session engine unreachable"                    | The `SESSION_ENGINE` binding is missing (e.g. a root `wrangler.jsonc` without the DO)                                                                                                                            |
| `phase: "error"` after scanning the QR                           | Wrong api_id/api_hash, or the login was cancelled; `POST /api/login/cancel` then retry                                                                                                                           |
| Scanning the QR fails with a generic client-side error           | The code was older than its ~30 s life (the SPA hides dying codes and counts down); prefer the phone-number path if the camera lag keeps losing the race                                                         |
| `phase: "error"` on the phone path                               | The number or code was rejected; the phase message names it (`PHONE_NUMBER_INVALID`, `PHONE_CODE_EXPIRED`, `FLOOD_WAIT_…`)                                                                                       |
| Updates never arrive while a tab is open                         | The socket failed live connect: look for a `{"type":"error"}` frame and `wrangler tail`                                                                                                                          |
| `getHistory` answers "chatId must be a marked Telegram peer id"  | The client sent a raw/unmarked id; channel ids must be `-100…`                                                                                                                                                   |
| Logs repeat "Not connected to any DC" in a tight loop            | The updates loop was started on an unsigned-in or disconnected client; the engine guards against both, so this means a stale build — redeploy and re-login                                                       |
| One `[mtcute:updates] … Session is reset` warning per disconnect | The update loop's in-flight `getDifference` lands on the teardown every wake performs; expected, and the wake itself still reports `ok`                                                                          |
