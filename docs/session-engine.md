# Session engine

How the `SessionEngine` Durable Object works, how to drive it locally, and how to run the milestone-1/2 acceptance.

## Shape

```
browser ──HTTP──▶ Pages (static + /api/* and /user/* proxies in functions/) ──service binding──▶ worker (Hono)
                                                                                      │
                                                                        SESSION_ENGINE Durable Object
                                                                                      │
                                                                     SessionEngine (worker/src/session/)
                                                                                      │
                                                                   MTProto over WSS (mtcute + @mtcute/wasm)
```

- One DO instance (`ENGINE_OBJECT_NAME = 'main'`) owns the account. All durable state is in its SQLite database:
  mtcute's auth keys, update cursor and DC/salt caches, plus five engine tables (`engine_wakes`, `engine_meta`,
  `engine_avatars`, `engine_unread_albums`, `engine_unread_state`). mtcute's peer and reference-message caches are
  memory-only — see [Free-tier posture](#free-tier-posture).
- The worker is **API-only** and, in production, not publicly reachable: `workers_dev: false`, no route, and the
  Pages project is the only caller (through the `API_WORKER` service binding).
- Locally the SPA talks to the worker through the Vite proxy (`/api` and `/user` are proxied from 5173 to 8787).

### Two modes

| Mode     | When                                             | What happens                                                                                         |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Wake** | Default; `alarm()` every `WAKE_INTERVAL_SECONDS` | connect → `getDifference` catch-up → record `engine_wakes` row → disconnect → re-arm                 |
| **Live** | At least one `/user/updates` socket is attached  | connect → catch up → stay connected; updates broadcast as they arrive; RPCs ride the same connection |

Leaving live: when the last socket closes, the engine disconnects and re-arms the wake cadence. A failed live
connect broadcasts `{"type":"error"}` to attached sockets and falls back to the wake cadence. An RPC burst on a
_waking_ engine arms a 60 s idle alarm, so a session is not torn down between calls but is also not kept forever.
Account presence is therefore **offline unless a browser tab is open**.

Both modes refuse to touch the network before the account is linked (`phase: "unauthorized"`): an anonymous
client has no DC to talk to, and mtcute's updates loop restarts without backoff when it cannot fetch its initial
state — which would pin the DO's CPU forever. A pre-login wake therefore records a no-op row (so the alarm cadence
stays observable in `/user/stats`) and connects nothing.

`WAKE_INTERVAL_SECONDS` (wrangler var, default `300`, minimum `30`) is the only cadence knob.

## Latency

A Durable Object hands out **one event at a time**: while a handler awaits, the next request waits behind it. Two
bridge calls therefore cost two round trips in sequence, no matter how the browser sends them — and each round trip
costs a Telegram round trip on the far side.

Inside one event the opposite holds: mtcute's transport multiplexes, so several Telegram calls can be in flight over
the one connection at the same time. **The lever is therefore: fewer events, and more concurrency inside each event.**

| Change                                                  | What it does                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `batch` (`POST /user/rpc`)                              | Several read-only methods in one request, run concurrently over the one connection                                                                                                   |
| `getHistory`'s `anchorId`                               | The jump-window fallback happens server-side, instead of costing a second round trip                                                                                                 |
| `getDialogs`                                            | The chat list and the contact presences are two independent Telegram reads, run together                                                                                             |
| The replay runs outside the input gate                  | `startLive` connects, then hands the `getDifference` catch-up to `waitUntil` — it is the longest event in the system, and holding the gate for it queued every bridge call behind it |
| The storage warms up before the first event             | `blockConcurrencyWhile` runs the migrations once, while the object is still empty                                                                                                    |
| The avatar cache (`engine_avatars`)                     | A profile photo is fetched from Telegram once and kept in the DO's SQLite; the chat list asks for one avatar per row, and every one of them was a Telegram round trip                |
| Avatars load near the viewport                          | A row nobody is looking at does not ask for its photo                                                                                                                                |
| `DialogDto.lastMessage` is a trimmed `DialogMessageDto` | The chat list renders a preview, a timestamp and a media label — not the message's entities, reactions, inline markup and nested reply quote                                         |

The chat list's own read is one `batch` of `getMe` and `getDialogs`, and the updates socket's first `ready` does not
read the list again: the boot has just read it. A reconnect still does, because the list may be stale then.

## Free-tier posture

The Free plan gives 10 ms CPU per invocation (wall time on waits is not CPU) and 100,000 rows written per day,
account-wide (reset 00:00 UTC; `setAlarm` and deletes count, and an indexed row costs one write per index). The design
keeps every wake small:

- **No history backfill.** `getDifference` update state is persisted; no dialogs/messages are fetched into the DO.
  History and media are served live through the bridge while the session is connected.
- **Read paths do not accumulate writes.** mtcute refills its peer and reference-message caches on every response, so
  those caches are memory-only; persisting them would rewrite every peer on each `getDialogs`/`getHistory`. Alarms are
  coalesced (`getAlarm()` before `setAlarm()`), and the wake log, avatar cache and album ledger writes are best-effort
  so the update stream and the chat list keep working when the row budget is spent.
- **Chunked crypto, not buffered payloads.** `/user/file`, `/user/avatar` and `/user/upload` stream; uploads are
  chunked and encrypted (AES-IGE) part by part on mtcute's upload pool. Upload CPU grows with the file size, so
  `UPLOAD_MAX_BYTES` is also the CPU-affordability knob — lower it if large uploads exhaust the budget.
- **WASM crypto.** SHA-1/IGE/gzip come from `@mtcute/wasm` (57 KB), imported as a `CompiledWasm` module and
  instantiated synchronously; the JS crypto is only for the random pool and 2FA (`crypto.subtle`).
- **Small bundle.** mtcute core is ~470 KB gzip in the worker bundle; the 3 MiB Free limit has plenty of room.
- **Bounded storage.** The DO's SQLite is the only storage (no D1, no R2). `GET /user/stats` reports
  `databaseBytes` so growth is visible in the soak.
- **The call's key exchange runs in the browser.** A 2048-bit modular exponentiation costs tens of milliseconds of
  CPU, and the caller's side needs two of them. That is several times the whole per-invocation budget, so the worker
  only fetches the public prime and generator (`messages.getDhConfig`) and hands them down; the page does the
  arithmetic and keeps the shared key. The worker never sees the key.

## Bridge API

The API surface is split by prefix. `GET /api/health` is the public plane: no Cloudflare Access gate, no account
data. Every account route lives under `/user/*`; the `user/[[path]].ts` Pages Function forwards them verbatim and the
worker verifies the `Cf-Access-Jwt-Assertion` application token (signature, issuer, audience and expiry) before
forwarding to the `SessionEngine`. The Access application's policy is the allowlist; the worker does not inspect the
token's email. Unless noted, responses are JSON, errors are `{"error": string}` with a 4xx/5xx status, and a
misconfigured deployment answers `503` with the engine's configuration message.

The public intro page cannot know whether an Access session exists until it probes `/user/state`. Its sign-in button
navigates to `GET /user/login`, which sits behind the same Access gate; after the login round-trip the worker redirects
the browser back into the SPA. The optional `next` query must be a same-origin absolute path (protocol-relative URLs,
backslashes, and CR/LF are rejected) and defaults to `/`.

| Route                       | Body / query                            | Returns                                                     |
| --------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `GET /api/health`           | —                                       | `{"status":"ok","service":"telegram-web-client"}`; public   |
| `GET /user/login`           | `?next=/path` (optional)                | `302` into the SPA; the Access entry point                  |
| `GET /user/state`           | —                                       | `EngineStateDto` (`phase`, `authorized`, `me`, `qrUrl`, …)  |
| `POST /user/login/qr`       | —                                       | `EngineStateDto`; starts (or joins) the QR login            |
| `POST /user/login/phone`    | `{"phone": string}`                     | `EngineStateDto`; sends a login code (phone-number path)    |
| `POST /user/login/code`     | `{"code": string}`                      | `EngineStateDto`; submits the login code                    |
| `POST /user/login/password` | `{"password": string}`                  | `EngineStateDto`; submits the 2FA cloud password            |
| `POST /user/login/cancel`   | —                                       | `EngineStateDto`; aborts an in-flight login                 |
| `POST /user/logout`         | —                                       | `{"ok": true}`; logs out, closes updates sockets, re-arms   |
| `POST /user/rpc`            | `{"method": string, "params"?: object}` | method-specific JSON (below)                                |
| `GET /user/updates`         | WebSocket                               | server events (below)                                       |
| `GET /user/file`            | `?chatId=&messageId=&thumb=1` + `Range` | media bytes (see below)                                     |
| `GET /user/avatar`          | `?chatId=&size=small\|big`              | profile photo bytes (`image/jpeg`, cached a day)            |
| `POST /user/upload`         | query params + raw body (see below)     | `{"message": MessageDto}`; sends one file                   |
| `POST /user/upload-group`   | `?chatId=&manifest=` + raw body         | `{"messages": MessageDto[]}`; sends 2–10 files as one album |
| `POST /user/wake`           | —                                       | `WakeCountersDto`; runs one wake cycle now                  |
| `GET /user/stats`           | `?days=1..30` (default 7)               | `StatsDto` (`counters`, per-day buckets, `databaseBytes`)   |

`GET /api/health` lives on the worker, not the engine, and is never gated; it carries no account data. The old
`/health` alias is gone, and no account route is served under `/api/*`: an old `/api/state` call is a 404.

### Media routes

`GET /user/file` serves every downloadable kind (photo/video/audio/voice/sticker/document) with the right content
type, resolved fresh from the message on each request — no file location or `file_reference` ever reaches the
browser. `thumb=1` answers with the best thumbnail instead (video posters). Videos and documents are served with
`accept-ranges`/`content-range` so `<video>` seeking works; the engine owns each byte window
(`session/media-stream.ts`): it requests from a 1 MB-block-aligned offset (mtcute's non-precise parts must not
straddle a 1 MB boundary), drops the extra prefix bytes, cuts the tail at the requested end and applies backpressure
(one chunk buffered), so a slow player never pulls the file into the isolate. Browser ranges are never forwarded to
mtcute as `limit`: it accepts only whole-file sizes and throws after the response headers have already gone out —
which is what used to kill playback after the first buffered seconds.

`GET /user/avatar` resolves the peer's photo server-side. The DTOs carry an opaque `photo` token
(`ChatPhoto.uniqueFileId`) purely to bust the browser cache; the SPA appends it to the URL as `v=`. The engine keeps
the bytes in `engine_avatars`, keyed by the version token **it** resolved (never the one the caller sent), so a repeat
request is a local read instead of another `upload.getFile` round trip.

`POST /user/upload` takes the file as the **raw request body** (no multipart); everything else rides the query
string: `chatId`, `kind` (`photo` | `video` | `animation` | `document`), `size` (required; must match
`content-length` when set), `fileName`, `mime`, `caption`, `replyTo` (a message id in the same chat), optional
`randomId` (the client-chosen idempotency key, see below), and
optional `width`/`height`/`duration`. `commentTo` (a channel post id) turns the upload into a comment on that
post: it is sent to the linked discussion group, and `replyTo` then names a comment inside the thread instead
of a message in `chatId`. The body is streamed through the DO into mtcute's upload connection pool, so nothing
buffers in the isolate, and `UPLOAD_MAX_BYTES` (wrangler var, default 100 MB) rejects oversized requests with a
413 before Telegram is touched. The query is parsed once more at the edge with the same parser, so a rejected
upload never reaches the DO at all — workerd reads a request stream after its response when a Durable Object
answers without consuming the body (cloudflare/workerd#918). The kind is never guessed server-side: the SPA converts non-JPEG
canvas-decodable images to JPEG (what official clients do) and falls back to `document` for anything else.

`POST /user/upload-group` sends an album. The body is the 2–10 files **concatenated in manifest order**, and the
`manifest` query parameter carries the per-file metadata as base64url-encoded JSON (`kind`, `size`, `fileName`, `mime`,
optional `width`/`height`/`duration`); `chatId`, `caption`, `commentTo` and `replyTo` ride along as they do for a single
file. The engine splits the one request body back into the exact byte ranges the manifest declared
(`session/upload.ts`: `UploadBodySplitter`) and hands them to mtcute's `sendMediaGroup`/`commentMediaGroup`, which
uploads the items strictly in order. The caption rides the first item only, and the reply is the album's messages
oldest first. The same parser runs at the edge, so a malformed manifest, a mixed album (a document next to a photo) or
an oversized total is rejected before the DO is touched; `UPLOAD_MAX_BYTES` caps the **total** of the album.

### RPC methods

| Method                | Params                                                                            | Returns                                                                                     |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `getMe`               | —                                                                                 | `{me}`                                                                                      |
| `getDialogs`          | `{limit?: 1..200, archived?: boolean}`                                            | `{dialogs: DialogDto[]}` (pinned first)                                                     |
| `getHistory`          | `{chatId, limit?: 1..100, offsetId?, offsetDate?, addOffset?: -50..0, anchorId?}` | `{messages: MessageDto[]}` (oldest first; the oldest album at the window edge is completed) |
| `sendMessage`         | `{chatId, text, replyTo?, randomId?}`                                             | `{message}`                                                                                 |
| `forwardMessages`     | `{chatId, toChatId, messageIds: number[]}`                                        | `{messages: MessageDto[]}` (the copies in `toChatId`)                                       |
| `readHistory`         | `{chatId, maxId?}`                                                                | `{}`                                                                                        |
| `searchMessages`      | `{chatId, query, limit?, offsetId?}`                                              | `{messages, nextOffsetId?}`                                                                 |
| `sendReaction`        | `{chatId, messageId, emoji?\|customEmojiId?}`                                     | `{message: MessageDto \| null}`                                                             |
| `sendVote`            | `{chatId, messageId, options: number[] \| null}`                                  | `{poll}`                                                                                    |
| `pressCallbackButton` | `{chatId, messageId, data}`                                                       | `{text: string \| null, alert: boolean, url: string \| null}`                               |
| `getPollResults`      | `{chatId, messageId}`                                                             | `{poll}`                                                                                    |
| `getComments`         | `{chatId, messageId, limit?: 1..100, offsetId?, offsetDate?}`                     | `{comments, count, discussionChatId, discussionMessageId, nextOffsetId?, nextOffsetDate?}`  |
| `sendComment`         | `{chatId, messageId, text, replyTo?, randomId?}`                                  | `{message}`                                                                                 |
| `getBotCommands`      | `{chatId}`                                                                        | `{commands: BotCommandDto[]}`                                                               |
| `setArchived`         | `{chatId, archived: boolean}`                                                     | `{chatId, archived}`                                                                        |
| `getProfile`          | `{chatId}`                                                                        | `{profile: ProfileDto}`                                                                     |
| `getCallDhConfig`     | —                                                                                 | `{g: number, p: string (base64), version: number}`                                          |
| `requestCall`         | `{chatId, gAHash: string (base64, 32-byte SHA-256), randomId: string}`            | `{call: CallDto}`                                                                           |
| `receivedCall`        | `{callId}`                                                                        | `{}`                                                                                        |
| `acceptCall`          | `{callId, gB: string (base64)}`                                                   | `{call: CallDto}`                                                                           |
| `confirmCall`         | `{callId, gA: string (base64), keyFingerprint: string}`                           | `{call: CallDto}`                                                                           |
| `discardCall`         | `{callId, reason: 'missed'\|'disconnect'\|'hangup'\|'busy', duration, video?}`    | `{}`                                                                                        |
| `rateCall`            | `{callId, rating: 1..5, comment?}`                                                | `{}`                                                                                        |
| `batch`               | `{calls: [{method, params?}]}` (1–8 calls)                                        | `{results: [{ok, result?, error?}]}`                                                        |

`getDialogs`'s `archived` flag reads the archive instead of the chat list: `true` returns the chats in Telegram's
peer folder `1`, `false` (the default) the ones in folder `0`. The two are separate reads on purpose — one limit over
both would cost the chat list the chats the archive holds.

`setArchived` moves a chat into the archive or brings it back out of it. The archive is Telegram's peer folder `1`,
and `folders.editPeerFolders` is the API the official clients use for it, so the move is the same one Telegram's own
clients make. The peer is resolved server-side, and the method is a write: it is not on the batch whitelist.

`getHistory`'s `anchorId` names the message the window has to hold: the engine reads _around_ it (with the newer
context beside it) and, when the first read missed it — a deleted post, or one past the end of the history — reads the
page that ends at it instead. The fallback the SPA used to spend a second round trip on now happens server-side.

`batch` runs several **read-only** methods in one request (see [Latency](#latency) below). The whitelist is
`getMe`, `getDialogs`, `getHistory`, `searchMessages`, `getPollResults`, `getComments`, `getBotCommands` and
`getProfile`; a
write is a 400, because a batch runs its calls concurrently and a write would have no defined completion order.
`readHistory` is excluded for the same reason it stays a single call: it moves the account's read watermark, and
`setArchived` because it moves a chat between the chat list and the archive. Each call reports its own outcome, so
one broken read (a post without a comments section) never takes the reads beside it down with it.

`chatId` is always a **marked** peer id: users positive, basic groups `-id`, channels/supergroups `-100…`.
The client never sends raw MTProto; the engine resolves peers server-side.

`randomId` is an optional client-chosen Telegram `random_id`: a positive decimal 64-bit integer that the engine
forwards to `sendText`/`commentText`/`sendMedia`. The SPA generates one per composed message and reuses it when a
failed send is retried, so a retry whose first attempt actually reached Telegram is dropped by Telegram instead of
posting the message twice. It is validated like every other parameter, so a malformed value is a 400 before the
network is touched. `POST /user/upload` takes it as a query parameter; an album (`POST /user/upload-group`) has none,
because Telegram picks the group's id — a retried album is a new album.

`getBotCommands` reads the slash-command menu Telegram associates with a chat. Commands are not part of the
dialog peer, so the engine looks at the full info instead: a user (`users.getFullUser`) carries one
`botInfo.commands` for a bot's private chat, while a group or supergroup (`messages.getFullChat`) carries one
`botInfo` per bot. The bridge flattens the group list, de-duplicates command names and returns
`{command, description}` in Telegram's order; an empty list is a normal answer, not an error. The SPA asks for
this when a bot, group or supergroup thread opens and offers the menu from the composer.

`getProfile` reads what the chat list has no room for: the bio of a person, the description and member count of a
group or a channel. Like the command menu, the answer is in the peer's full info, so the engine reads the full user
for a positive id and the full chat for a negative one. A bot's own description stands in for its bio, which a bot
usually leaves empty. The read is on demand — the SPA asks for it when the reader opens the profile, so a thread open
pays for nothing. It is on the batch whitelist, because it is a read like the others.

`DialogDto` carries the chat, its `lastMessage`, `unread`, `readInboxMaxId` (the read watermark: the
last read incoming message) and `readOutboxMaxId` (the last outgoing message the peer has read), plus
`pinned`/`muted` and `archived` (whether the chat sits in the account's archive — Telegram's peer folder `1`; every
other chat is in folder `0`). The SPA opens a chat at the first incoming message after the inbox watermark instead of
the bottom, and renders a single check for sent own messages and a double check up to the outbox watermark.
`readHistory`'s optional `maxId` reports how far the user actually scrolled (omitted, it reads the whole
history — the comments screen's behavior). `ChatDto.presence` carries the peer's online state — see
[Presence](#presence) below.

`unread` is Telegram's own count **minus the album surplus** — see
[Albums count once](#albums-count-once) below.

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

`forwardMessages` moves one message or an album (`messageIds`, 1–100 distinct source-chat ids) into
`toChatId` and answers with the copies Telegram created there, so the SPA can fold them into the destination
dialog without waiting for the socket. The destination picker offers only dialogs whose `canSendMessages` is
true; protected content can still be rejected by Telegram, in which case the error stays in the picker.

`getHistory`'s `addOffset` skips that many messages from `offsetId` (negative is towards newer), which is how a
`t.me` post link opens a window _around_ the linked post instead of the newest messages; `offsetId` alone is
accepted (the link names the post but not its date, so the omitted date reads as 0).

A message that replies to another carries `reply`: where the original lives (`origin`), its `messageId`/`chatId`
when known, `senderName`/`date`, explicit quote `text`/`entities`, `mediaKind`, and the `quote` flag. Same-chat
headers carry only the message id, so the SPA resolves the quote's sender and snippet from the thread it already
has; `sendMessage` takes `replyTo` (a message id in the same chat) to send one.

A forwarded message carries `forward`: the origin's `senderId`/`senderName`/`senderUsername` (a hidden forward's
name instead of an id), the original's `date`, the original chat/message for saved-messages forwards and channel posts
(`fromChatId`/`fromMessageId`), and the post `signature` when the header has one. `worker/src/session/dto.ts` maps
it from Telegram's forward header, and the bubble renders a "Forwarded from …" line above the sender name. Only the
origin name is a control: it opens the origin chat when that chat is among the loaded dialogs, and otherwise hands off
to the installed app by username or marked id.

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

### Albums count once

Telegram counts every album member as a message: an album of ten files arrives as an unread count of ten. The
badge counts the album once, so the engine keeps the album members it has seen and subtracts the surplus — the
unread members of an album beyond the first of that album.

The **album ledger** (`worker/src/session/unread-albums.ts`) is that bookkeeping. It lives in the DO's SQLite
(`engine_unread_albums`, one row per unread album member; `engine_unread_state`, the reconciliation marker) because
the engine sleeps between its wakes and the album members outlive the connection that delivered them. It learns
from the update stream, so it costs no Telegram traffic: an incoming album member is recorded, and a read drops
the members its watermark covered. The ledger's surplus is subtracted from the count `getDialogs` serves and from
the `unread` a `read` update carries, so the badge and the chat list agree.

A fresh sign-in starts with an empty ledger while the account may already carry unread albums, so the first
`getDialogs` reconciles: it reads the unread range of every chat with unread messages and records the album
members in it. That happens once per sign-in — the update stream keeps the ledger current from then on — and a
read that fails only leaves that chat's count at Telegram's raw one.

The SPA counts the same way: `DialogMessageDto.groupedId` tells it that a new message continues the album the chat
list already counted, and the optimistic read-through subtracts albums rather than messages.

### The archive

Telegram keeps the archived chats in the peer folder with the id `1`; every other chat is in folder `0`. The engine
reads the two apart: `getDialogs` without the `archived` flag is the chat list (`messages.getDialogs` with
`folder_id: 0`), and with it the archive (`folder_id: 1`). They are separate reads on purpose — one limit over both
would cost the chat list the chats the archive holds, and the archive is a screen the reader asks for, not one every
list load pays for.

`setArchived` moves a chat between the two. It resolves the peer server-side and calls `folders.editPeerFolders`,
the API the official clients use for the archive, so the move is the one Telegram's own clients make.

On the SPA side the archive is a screen of its own (`/archived`), reached from the account popup in the sidebar. The
chat list and the archive live in one list (`pages/src/useDialogs.ts`), so every lookup of a chat — the router, the
thread, the read receipts, the forward picker — finds it in the same place. The thread's ⋮ menu carries the move
itself: an archive item for a chat in the list, an unarchive item for one in the archive. The item asks first — the
move is confirmed in a modal — and the outcome is announced in a toast. The sidebar keeps the archive in view while one
of its chats is open; bringing that chat back out of the archive hands the sidebar to the chat list, where it now lives.

### Updates socket protocol

Client → server: `{"type":"hello"}` (attach; engine goes live), `{"type":"ping"}` (25 s keepalive) and
`{"type":"call_signaling","callId":"…","data":"<base64>"}` (a signalling packet on its way to the other peer of a
call).
Server → client: `{"type":"ready"}`, `{"type":"pong"}`, `{"type":"error","message":…}`, and
`{"type":"update","update":{"type":"new_message"|"edit_message"|"reactions"|"views"|"poll"|"read"|"user_status"|"call"|"call_signaling", …}}`.
The `reactions` update carries `{chatId, messageId, reactions}` (no full message) whenever anyone reacts.
The `views` update carries `{chatId, messageId, views}` (again no full message), mapped from Telegram's
`updateChannelMessageViews`, so a channel post's counter ticks live for as long as the thread is loaded.
The `poll` update carries `{chatId, messageId, pollId, poll}`: `pollId` is what identifies the poll both for the
short `updateMessagePoll` (no body) and for `updateMessagePollVote`, which names the poll but neither its chat nor
its message. A null `poll` means "recheck this one": the SPA calls `getPollResults` for the loaded message and folds
the answer in, so results stay live without the engine holding per-poll state. `sendVote` answers with the same DTO,
so the caller's own vote renders without waiting for the socket.
The `read` update carries `{chatId, maxId, unread, inbox}`: `inbox` distinguishes the account's own inbox
from the peer reading the account's messages. Only inbox reads move `unread` and `readInboxMaxId`; outbox
reads move `readOutboxMaxId`, which is what turns the account's own double checks on. The `unread` of an inbox
read is the album-aware count — see [Albums count once](#albums-count-once).
The `user_status` update carries `{userId, presence}` and says that a peer came online or went offline.
The `call` update carries `{call: CallDto}` and says that a call was requested, accepted, confirmed or discarded;
the `call_signaling` update carries `{callId, data}` and is an opaque packet on its way from the other peer — see
[Calls](#calls) below.

### Calls

A voice call is three things stacked on top of each other: a **handshake** Telegram's server relays, an
**encrypted signalling channel** between the two peers, and the **media**, which travels directly between them and
never comes near this worker.

**The handshake** is Telegram's own `phone.*` family, and it is the only part that has to interoperate with the
server:

| Step                | Method                | What it carries                                                                       |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| The caller asks     | `phone.requestCall`   | the caller's commitment: SHA-256 over its Diffie-Hellman value (`g_a_hash`, 32 bytes) |
| The callee answers  | `phone.acceptCall`    | the callee's own public Diffie-Hellman value (`g_b`)                                  |
| The caller confirms | `phone.confirmCall`   | the caller's public value (`g_a`) and the fingerprint of the shared key               |
| The call ends       | `phone.discardCall`   | why it ended and how long it ran                                                      |
| The call is rated   | `phone.setCallRating` | a score from 1 to 5 and a comment                                                     |

`phone.receivedCall` tells the server that somebody is at the phone, so it stops offering the call to the account's
other devices.

The bridge's `call.*` methods are the one documented exception to the rule that the engine resolves peers
server-side: they carry **opaque bytes** — the Diffie-Hellman values and the signalling packets — because those
belong to the two peers and not to the bridge. Everything else still holds: a call is addressed by its **id**, and the
access hash that addresses it never leaves the engine. `CallRegistry` (in the DO's memory) keeps the hash of every
call the engine has seen and hands it back when a method needs it; a call the engine has never seen is a 404.

The bytes travel as base64 and the 64-bit numbers as decimal strings, because JSON cannot hold either.

**The key exchange** happens in the page, not here. `getCallDhConfig` reads `messages.getDhConfig` and hands the
prime and the generator down; the browser does the modexp (which does not fit in the Free plan's CPU budget), keeps
the shared key, and sends only what Telegram's protocol puts on the wire. The worker never sees the key — and it
does not have to, because the signalling packets are already encrypted with it.

**The signalling channel** is the encrypted envelope Telegram documents for calls: a 32-bit counter in front of each
message, and a per-message key schedule derived from the shared key. The channel carries the WebRTC handshake — the
session description and the ICE candidates — which is why the peer connection is authenticated: the description
arrives inside a channel only the two peers can read, so the DTLS fingerprint it carries cannot have been swapped on
the way. The packets ride the **updates socket**, not `POST /user/rpc`: a WebSocket message is not a Worker request,
so a call setup does not spend the Free plan's daily request allowance, and the relay runs outside the Durable
Object's input gate (`waitUntil`) so an ICE-candidate burst does not queue every other bridge call behind it.

**The media** is a WebRTC peer connection between the two browsers. Telegram's server hands out the relays
(`phoneCall.connections`); the page turns the WebRTC ones into ICE servers and the browser does the rest — the audio
is a plain media track, Opus over DTLS-SRTP. **No media ever transits Cloudflare.**

A call also **pins the live session**: the signalling rides the account's connection, so the engine keeps the
connection up while a call is up, even across a dropped browser socket. Without that, the two peers would lose the
signalling in the gap before the browser reconnects.

**What is not here yet.** The signalling payload _inside_ the encrypted envelope is this client's own format (a
version byte and a JSON body — `pages/src/calls/signalling.ts`), so a call between two instances of this client
works, but a call between this client and Telegram's native clients does not: those speak tgcalls' own message
format, which is not publicly specified. That, and the exact byte order of the key fingerprint, is
[Milestone 4](#milestone-4--native-interoperability) below.

### Presence

A peer's presence is a person's online state; a bot, a group and a channel never have one. `ChatDto.presence`
is `{status, lastSeenAt}` (`status` is `online`, `offline`, `recently`, `within_week` or `within_month`;
`lastSeenAt` is the exact last-sighting timestamp, which only the `offline` state carries) or `null` when
Telegram said nothing.

Two sources feed it, and the engine uses both (`session/presence.ts`):

- **`contacts.getStatuses`** is authoritative for the account's contacts. `getDialogs` reads it once per call
  and overlays the answer on the chat list, so the presence rides the payload the SPA already fetches. The
  method is unavailable to bot accounts, so an unreadable answer degrades to no presences at all rather than
  to an error — a chat list without dots beats no chat list.
- **The peer object itself** carries the state Telegram attached to the user, which covers people outside the
  contact list.
- **`updateUserStatus`** (mapped to the `user_status` update) reports every change that follows, so a dot
  appears and disappears while the list is open. The engine's wake cycle replays the same updates through
  `getDifference`, so a peer that changed state while no tab was attached is current again on the next load.

Telegram only reveals what a peer shares, so the presence is best-effort: the official clients show the same
incompleteness.

## Local development

```bash
cp .dev.vars.example .dev.vars        # fill in api_id/api_hash
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler dev                # worker on :8787
pnpm --filter @telegram-web-client/pages dev   # SPA on :5173, /api and /user proxied
```

Local development does not pass through Cloudflare Access. The example `.dev.vars` sets
`ENVIRONMENT="development"` and `ACCESS_DEV_BYPASS="true"`; the worker skips JWT verification only outside
production and fails closed if the bypass is ever present with `ENVIRONMENT="production"`. Never set the bypass on a
deployment. Because the bypass makes the `/user/state` probe succeed, local development goes straight to the QR login;
the public intro is what an anonymous browser sees when Access is actually in front of `/user*`.

Smoke checks (no Telegram credentials needed for the first two):

```bash
curl -s localhost:8787/api/health                                # public plane
curl -s localhost:8787/user/state                                # → phase "unauthorized" (dev bypass)
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
2. Deploy (`wrangler deploy` + secrets + the Access vars), then `GET /api/health` without a credential and
   `GET /user/state` through Cloudflare Access. A service token is the clean way to script the user API:
   `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://<pages-host>/user/state`.
   In a browser, the same round-trip is: intro → **Sign in with Cloudflare Access** → `/user/login` → back to `/`
   (or the `next` path) → QR login.
3. `POST /user/wake` answers with `totalWakes: 1, failedWakes: 0` and the DO returns to sleep; verify with
   `GET /user/stats` that `avgWakeMs` fits the plan's limits and `lastWakeAt` is recent.
4. QR login completes end-to-end: `phase` walks `qr → scanned → (password) → authorized`, and `me` is populated.
5. A message sent to the account from another device appears in the SPA within a wake interval or immediately while
   a tab is open (live mode); sends and reads round-trip, a photo/video upload lands in the thread and as the chat
   preview, and avatars render in the chat list, thread header and sidebar.
6. `wrangler tail` shows no unhandled exceptions during the cycles above.

## Milestone 2 — 72 h soak

After the spike passes, leave the deployment at the default 300 s cadence for 72 hours with a tab closed
(so every cycle is a wake):

- Poll `GET /user/stats?days=30` daily (or keep the SPA open and read the soak numbers); watch
  `counters.failedWakes`, `days[].avgMs`, `days[].updates`, and `databaseBytes`.
- In the Cloudflare dashboard, check the worker's CPU-time metrics and the DO's storage/size metrics against the
  Free plan; confirm no wake exceeds the per-invocation CPU budget. Also watch the DO namespace's **rows written**
  against the 100,000/day budget: a cold wake that reads the chat list should move it only by the session's own
  bookkeeping (the update cursor and the next alarm), not by one row per peer.
- The soak's job is to prove the cadence, the storage shape, and the CPU profile — a failed wake must be a
  recorded row (`engine_wakes.ok = 0` with `error`), never a silent stop. The engine re-arms after failures.

## Milestone 3 — call acceptance

The calls need two accounts and two browsers. Everything below is checked with the deployment behind Access, so the
second browser signs in through the same gate (a second device, or a private window with another Access identity).

1. **The caller's side.** Open a one-to-one chat, press the ☎ in the thread header and confirm the request. The
   overlay says "Calling…" and the peer gets an incoming call: the ringtone sounds, the peer's name and picture are
   on screen, and the fingerprint line is empty until the key exchange is over.
2. **The handshake.** The peer's overlay offers Answer and Decline. Answering completes the exchange: both sides
   show the same key fingerprint, and the call goes to "Connecting…" and then to the timer.
3. **The media.** Both sides hear each other. The caller's clock and the peer's clock agree. The mute button stops
   the microphone on that side only, and the timer keeps running.
4. **Ending it.** The hang-up button ends the call on both sides; the overlay says the call ended and then goes
   away. The caller's duration matches the peer's within a second.
5. **Declining.** A declined call shows "the call ended" on the callee's side, and the caller sees the same.
6. **The worker stays out of it.** `wrangler tail` shows the `phone.*` round trips and the signalling relay, and no
   media bytes anywhere. The worker's CPU time does not move during the call: the key exchange happened in the
   browser.
7. **The costs.** `GET /user/stats` shows the extra requests the handshake spent (seven RPC calls and the socket
   frames), and the daily request allowance is nowhere near its limit after a day of calls.
8. **A dropped socket.** Kill the browser's network for a few seconds during a call and restore it: the call
   survives, because a call pins the live session.

## Milestone 4 — native interoperability

Everything above is a call between two instances of this client. Two things are still open before a call reaches
Telegram's own apps, and both need a real account to settle:

1. **The signalling format.** The payload inside the encrypted envelope is this client's own (a version byte and a
   JSON body). Telegram's native clients speak tgcalls' message format, which is not publicly specified, so this
   client cannot produce it yet. The envelope around it — the key schedule, the counter, the replay window — is
   implemented exactly as documented and is the part a native client would interoperate with.
2. **The key fingerprint's byte order.** Telegram's documentation says the fingerprint is "the lower 64 bits of
   SHA1(key)" — the same phrasing MTProto uses for the auth key's identifier, whose bytes are the _first_ eight of
   the digest read little-endian, while the secret-chat page says "the 64 **last** bits". The two readings differ.
   This client uses the auth-key convention; a native client may not. The fingerprint is a sanity check between the
   two peers, so a mismatch shows up as a failed key check rather than as a silent wrong key.

Both are settled by running one browser against Telegram Desktop or a phone, with the fingerprints of both sides
compared. Until then, the honest statement is: **a call works between two instances of this client, and not yet
with Telegram's own clients.**

## Deploy and gate

```bash
pnpm exec tsx scripts/prepare-wrangler-config.ts
pnpm exec wrangler deploy
pnpm exec wrangler secret put TELEGRAM_API_ID
pnpm exec wrangler secret put TELEGRAM_API_HASH
```

The worker verifies Cloudflare Access on `/user/*`, so the deployment also needs both verifier vars — through
`WRANGLER_VARS_PATCH_JSON` in CD or the dashboard:

```json
{ "TEAM_DOMAIN": "https://<team>.cloudflareaccess.com", "POLICY_AUD": "<application-aud-tag>" }
```

Missing or malformed values make `/user/*` answer `503 {"code":"access_config"}`; there is no unauthenticated
fallback. `GET /api/health` is unaffected and remains public. Set them before deploying this change.

Pending owner actions (one-time):

1. `api_id` / `api_hash` from my.telegram.org (the QR login needs them).
2. Attach the production domain to the **Pages** project, issue the certificate, then put a self-hosted Cloudflare
   Access application (with an allow policy for the owner) in front of the public hostname. Do not use an Access
   application targeting the worker: Worker-destination Access rejects WebSocket upgrades. Scope the application path
   to `/user*`, so `/`, the SPA assets, and `GET /api/health` stay reachable without a login while the user API and the
   `/user/login` entry point are gated. Copy its AUD tag and the team domain into the verifier vars above.
3. Optionally create an Access **service token** for scripted checks (`/user/stats` during the soak), and add a
   Service Auth policy to the application.

## Troubleshooting

| Symptom                                                            | Cause                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/health` → login redirect or `401`                            | The Access application still covers `/api/*` at the edge; scope its path to `/user*` (a host-wide app must keep `/` and `/api/*` public)                                                                                                                     |
| `/health` → `404`                                                  | Expected: the health route moved to `/api/health`                                                                                                                                                                                                            |
| `/api/state` → `404`                                               | Expected: account routes moved to `/user/*`; use `/user/state`                                                                                                                                                                                               |
| `/user/*` → `401 {"code":"access"}`                                | The request reached the worker without a valid `Cf-Access-Jwt-Assertion`: the hostname is not behind Access, the Access session expired, or a service-binding call skipped it. The SPA falls back to the intro; sign in again through `/user/login`          |
| `/user/*` → `503 {"code":"access_config"}`                         | `TEAM_DOMAIN`/`POLICY_AUD` are missing or malformed, or `ACCESS_DEV_BYPASS` is set with `ENVIRONMENT="production"`                                                                                                                                           |
| `/user/*` → `503` "TELEGRAM_API_ID…"                               | Secrets are missing on the deployment (the engine reports the configuration error)                                                                                                                                                                           |
| `/user/*` → `503` "Session engine unreachable"                     | The `SESSION_ENGINE` binding is missing (e.g. a root `wrangler.jsonc` without the DO)                                                                                                                                                                        |
| `phase: "error"` after scanning the QR                             | Wrong api_id/api_hash, or the login was cancelled; `POST /user/login/cancel` then retry                                                                                                                                                                      |
| Scanning the QR fails with a generic client-side error             | The code was older than its ~30 s life (the SPA hides dying codes and counts down); prefer the phone-number path if the camera lag keeps losing the race                                                                                                     |
| `phase: "error"` on the phone path                                 | The number or code was rejected; the phase message names it (`PHONE_NUMBER_INVALID`, `PHONE_CODE_EXPIRED`, `FLOOD_WAIT_…`)                                                                                                                                   |
| Updates never arrive while a tab is open                           | The socket failed live connect: look for a `{"type":"error"}` frame and `wrangler tail`                                                                                                                                                                      |
| `getHistory` answers "chatId must be a marked Telegram peer id"    | The client sent a raw/unmarked id; channel ids must be `-100…`                                                                                                                                                                                               |
| A chat that is valid in the official app answers `PEER_ID_INVALID` | A min peer from a group/channel message poisoned mtcute's in-memory cache; `session/peers.ts` re-stores the full entity and retries once (look for `[engine] peer rejected, refreshing`). A repeat failure means the peer is genuinely gone from the account |
| Logs repeat "Not connected to any DC" in a tight loop              | The updates loop was started on an unsigned-in or disconnected client; the engine guards against both, so this means a stale build — redeploy and re-login                                                                                                   |
| One `[mtcute:updates] … Session is reset` warning per disconnect   | The update loop's in-flight `getDifference` lands on the teardown every wake performs; expected, and the wake itself still reports `ok`                                                                                                                      |
