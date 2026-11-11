# Telegram Widgets (media newer than our MTProto layer)

**Status: deliberately unsupported.** The engine names the payload and the SPA shows a labelled card with an
_Open In Telegram_ link; nothing tries to render the widget. This file is the pick-up brief for the day we do.

Reference case: `https://t.me/dmhyshare/132281` — the 動漫花園資源網 channel posts widgets, so **every** post in it
arrives as unsupported.

## The symptom

- In Pigeongram the bubble is empty: `getHistory` returns `text: ""`, `entities: []`, `media: null`, `webPage: null`,
  while the envelope (`senderName`, `date`, `views`, the edited flag) is intact.
- On `t.me` the same post — and every other post in that channel — renders as _Please open Telegram to view this post_.
  t.me's viewer does not render widgets either, so a t.me link is **not** a way to check a post's content.
- The official app shows a photo and a long caption: both live **inside** the widget's HTML (a `data:` image and the
  styled text), which is why nothing can be copied out of it as a file.

## What a widget is

Introduced with **MTProto layer 233** (Bot API 10.4), a widget is a message whose media is one self-contained
**mini-HTML document**:

```tl
messageMediaWidget#2238f214 flags:# is_copy:flags.0?true can_query:flags.1?true background_query:flags.2?true
  width:int height:int payload:bytes public_data:flags.3?bytes chat_data:flags.4?bytes
  widget_id:flags.5?long = MessageMedia;
```

- Inline CSS and JS, `data:` images only, no external resources. At most **32 KB of HTML**, and at most **4 KB
  compressed**.
- `payload` is a **zlib** stream (RFC 1950: 2-byte header, raw deflate, 4-byte Adler-32) — not gzip (RFC 1952) and not
  raw deflate (RFC 1951). Inflate with zlib semantics.
- Bots send widgets to their private chat and to groups they are in; `inputMediaWidget` also appears in inline results.
  Channels cannot be posted to directly, but a **forward** is allowed anywhere: a forward is `is_copy`, runs the same
  HTML, keeps a frozen copy of the shared state and has no chat state.
- Two kinds of state, both written only by the bot: `public_data` (shared, visible in the original and every forward)
  and `chat_data` (per-message, never copied by a forward). Both at most 1024 bytes of UTF-8. A **shared widget**
  (`widget_id`) is a server object, like a poll: one HTML/state per object, refreshed through
  `messages.getWidgetPublicData` and edited with `messages.editWidgetData`.
- When the send allowed it (`can_query` / `background_query`), the widget may **ask the bot**: the client calls
  `messages.getBotWidgetQueryAnswer(peer, msg_id, data)` and the bot answers with `messages.setBotWidgetQueryAnswer`.
  Live state changes arrive as `updateMessageWidgetData`.
- Sending/editing: `inputMediaWidget` / `inputMediaWidgetId`, `messages.sendMedia` / `uploadMedia`,
  `messages.editMessageWidgetData` / `editInlineBotMessageWidgetData`.

## Why our client sees nothing

- `@mtcute/core@0.32.7` advertises MTProto **layer 232** (`tl/inner-tl.js`, `const LAYER = 232`).
- For a media type the advertised layer cannot read, Telegram substitutes **`messageMediaUnsupported#9f84f49e`** and
  **blanks the caption** (see `core.telegram.org/constructor/messageMediaUnsupported`, and aiogram issue #1981:
  _"Old clients (< layer 233) receive messageMediaUnsupported"_).
- mtcute's `_messageMediaFromTl` has no case for `messageMediaWidget`, and the unsupported marker falls into its
  `default: return null`, so the high-level `media` is `null` and the DTO would be empty.
- The engine therefore maps the marker to `MessageMediaDto.kind: 'unsupported'`
  (`packages/backend-services/src/session/dto.ts`), and the SPA renders `MessageUnsupported`
  (`apps/web/src/components/UnsupportedMedia.tsx`) — a card that names the gap and links the post in Telegram. The same
  card covers a message that arrives with no text, media, poll or preview at all, so no bubble can be blank.

## Picking it up

1. **Bump the client.** `@mtcute/core@0.32.8` is layer **233**: `tl/inner-tl.js` has `const LAYER = 233`, a `Widget`
   media class (`highlevel/types/media/widget.*`: `raw`, `id`, `isCopy`, `canQuery`, `canQueryInBackground`, `width`,
   `height`, `payload`, `publicData`, `publicDataHash`, `chatData`, `inputMedia`), the `messageMediaWidget` case in
   `_messageMediaFromTl`, and `client.decodeWidgetHtml(widget | bytes)` (client-side inflate, 32 KB cap). `@mtcute/wasm`
   moves with it. Re-check the min-peer guard (`session/peers.ts`) against the new version — the 0.32.6 note in
   `AGENTS.md` is a different bug and must stay fixed.
2. **Bridge the payload.** Add a `'widget'` `MessageMediaKind` carrying the **zlib payload as base64** (JSON has no byte
   string), plus `width`/`height` (`0` means auto) and the `canQuery`/`canQueryInBackground`/`isCopy`/`widgetId` flags.
   Shipping the compressed bytes and inflating in the browser (`DecompressionStream('deflate')`, which is RFC 1950)
   keeps a thread's payload small; a 32 KB HTML per message in JSON is not acceptable.
3. **Render with the official sandbox, not a hand-rolled iframe.** `@telegram/widget-sandbox` (package
   `packages/core`, pinned release tag, e.g. `v0.6.0`; not on npm — a Git dependency
   `github:TelegramMessenger/widget-sandbox#v0.6.0&path:packages/core`) owns a QuickJS/WASM engine, the validator, the
   renderer and the quotas (8 MB memory, 500 ms CPU, 300 ms per 1 s, 100 ms host main-thread work, 64 timers), with
   `setVisible`/`setTheme`/`destroy` for bubble lifecycle and a "Widget stopped" state when the code is killed. The
   sandbox **is** the security boundary: widget HTML is bot-supplied, and a plain sandboxed iframe offers no CPU/memory
   limits, no validator and no way to stop a runaway widget.
4. **Requests and state** (only if the product wants interaction): `messages.getBotWidgetQueryAnswer` +
   `setBotWidgetQueryAnswer` over the bridge, `updateMessageWidgetData` on the updates socket, and
   `messages.getWidgetPublicData` for shared widgets.
5. **Sending** widgets is bot-only; a read client needs none of `inputMediaWidget`.

Checklist before starting:

- Confirm mtcute still advertises layer ≥ 233 and exposes the widget media (a newer release may rename or restructure
  it).
- Check `DecompressionStream('deflate')` support in the browsers the app targets, and keep the engine-side
  `decodeWidgetHtml` as the fallback.
- Measure the SPA bundle: the sandbox's bundles and WASM are large; decide lazy-loading before wiring it into the
  thread.
- The widget reports its own height; the thread's scroll anchor (`thread-position.ts`, `settleToBottom`) must re-pin
  when it changes.
- A widget's caption is blanked by the server while we are on an older layer, so nothing is lost by showing the
  placeholder; once on 233 the caption arrives normally.

## References

- <https://core.telegram.org/bots/widgets> — the format, availability and the "unsupported media with its caption" rule.
- <https://github.com/TelegramMessenger/widget-sandbox> — `docs/tgw-format.md` (TL, packing, inflating, state and
  requests) and `docs/integration.md` (the host contract, quotas, lifecycle).
- <https://core.telegram.org/constructor/messageMediaUnsupported> — the marker an old layer receives.
- aiogram issue #1981 (2026-11-07) — layer 233 and the "old clients get `messageMediaUnsupported`" behaviour.
