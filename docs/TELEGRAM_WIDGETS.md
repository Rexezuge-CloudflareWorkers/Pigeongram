# Telegram Widgets (layer 233 media)

**Status: read-only rendering in the official sandbox.** A widget post is a real media kind in the bridge and a
sandboxed bubble in the SPA. Bot queries, widget state edits, shared-state polling, widget Web Storage and sending
widgets are deliberately out of this pass; see [What is not here yet](#what-is-not-here-yet).

Reference case: `https://t.me/dmhyshare/132281` — the 動漫花園資源網 channel posts widgets, so nearly every post in it
is a widget. t.me does **not** render widgets ("Please open Telegram to view this post"), so it is not a way to check
the content.

## What was wrong

- `@mtcute/core@0.32.8` (pinned here) advertises MTProto **layer 233** and decodes `messageMediaWidget` into a `Widget`
  with a zlib `payload`, size anchors, the server's flags and the two state strings. The old runbook's layer-232 symptom —
  `messageMediaUnsupported` with a blank caption — no longer applies to widgets.
- The engine used to drop that media kind, so a widget reached the SPA as a caption-only bubble. The `unsupported` card
  is still the fallback for a payload newer than the advertised layer (or one the SPA cannot inflate), and for a message
  with no media, text, poll or preview at all.

## How it works now

1. **Bridge** (`packages/backend-services/src/session/dto.ts`): `case 'widget'` maps mtcute's `Widget` into
   `MessageMediaDto.kind: 'widget'` plus a `widget` object — the compressed payload as base64 (JSON cannot hold bytes),
   `width`/`height` (`0` means auto), `isCopy`, `canQuery`, `canQueryInBackground`, `widgetId`, `publicData`, `chatData`
   and `publicDataHash` (ids as decimal strings). The HTML is inside the message; there is no file and no new
   `/user/file` route. The three optional flags are coerced to `false` when Telegram omits them.
2. **Inflate** (`apps/web/src/widget-decode.ts`): `DecompressionStream('deflate')` inflates RFC 1950 zlib (not gzip,
   not raw deflate). Telegram enforces the 4 KB compressed / 32 KB uncompressed limits, so the browser adds none. A
   browser without the API, or a malformed payload, falls back to the labelled card.
3. **Render** (`apps/web/src/components/WidgetMedia.tsx`): `@telegram/widget-sandbox`'s `WidgetHost` runs the HTML in a
   QuickJS/WASM worker through its validator and Shadow DOM renderer, with strict policy and `webAnimations`. There is
   **no `onRequest`**, so every bot query is refused by the sandbox and no network marker is drawn; there are no
   `onCopyText`, storage or `setData` callbacks. The bubble reserves the bot's size anchors (width clamped to
   `[200, 420]`, height to `[50, 600]`), caches the last reported height per message, calls `setVisible(false)` when it
   scrolls out and `destroy()` on unmount. Ordinary links show a confirmation with the full URL; `t.me` links go through
   the SPA's Telegram-link handler. A dead host falls back to the card. The workspace pins `parse5` to `8.0.1`, the
   version the sandbox release's bundle rewrites were written against (8.1 changed the import text).
4. **Load** (`apps/web/src/widget-loader.ts`): the sandbox is a dynamic import on the first widget a thread shows, so
   its bundles and WASM never ride the first paint. `apps/web/build/widget-sandbox-bundles.ts` prebuilds the sandbox's
   two in-page bundles with `tsx` (the package ships raw TypeScript that Vite cannot import from its config), and
   `apps/web/build/widget-sandbox-plugin.ts` serves those generated files and sets the development server's isolation
   headers. The generated files are gitignored; both `dev` and `build` regenerate them.

### Dependency and deployment details

- The package is **not on npm**: `apps/web/package.json` pins `github:TelegramMessenger/widget-sandbox#v0.6.5&path:packages/core`.
  Its own monorepo resolves the QuickJS engine with `workspace:*`, which cannot resolve as a transitive dependency here,
  so `pnpm-workspace.yaml` overrides that name with the same tag's `packages/quickjs-wasm` and allows this one exotic
  subdependency. Keep both entries at the same tag and re-check the API on any bump; never pin a branch.
- The sandbox's synchronous query bridge uses `SharedArrayBuffer`, so the document must be cross-origin isolated.
  `apps/web/public/_headers` sends COOP `same-origin`, COEP `require-corp` and CORP `same-origin` on the static plane;
  the Vite plugin does the same in development. All assets are same-origin, and Cloudflare Access's round-trip is a
  top-level navigation, which COOP does not block. `test/pwa/isolation.test.ts` guards the file.
- The sandbox ships raw TypeScript with `virtual:*` modules and dev-only typings, so `apps/web/src/widget-sandbox-api.d.ts`
  declares the small host surface we consume and the web/test tsconfigs `paths`-map the two host specifiers to it. Vite
  resolves the real modules at build time, unaffected by the type-only mapping.

## What is not here yet

The server's flags and state already cross the bridge, but this pass does not use them:

- `onRequest` → `messages.getBotWidgetQueryAnswer` / `setBotWidgetQueryAnswer` over the bridge (a write, not batchable),
  with timeout/rate-limit/failure mapping.
- `updateMessageWidgetData` on the updates socket (`setData` on the live host), plus `messages.getWidgetPublicData`
  polling of one visible carrier per `widget_id` while `watchesPublicData` is true, at the server's `period`.
- Web Storage per (account, chat, message id) with `onStorageCommit`, theme propagation beyond creation, gesture
  arbitration (`bubbleGestures`), the network marker for `canQuery`, and the copy-text callback.
- Resize-anchor scroll compensation in `thread-position.ts` when a widget changes auto height.

Sending widgets needs `inputMediaWidget` and is bot-only; a read client does not need it.

## Verification

Unit tests exercise the engine DTO (`test/session/dto.test.ts`), zlib inflation (`test/web/widget-decode.test.ts`), the
bubble lifecycle with a mocked host (`test/web/widget-media.test.tsx`) and the header file (`test/pwa/isolation.test.ts`).
Live acceptance needs an account and the sandbox's conformance corpus (the test channel in
`TelegramMessenger/widget-sandbox`):

1. Open `https://t.me/dmhyshare/132281`: the post renders as a bubble with its caption, not the placeholder card.
2. Open one conformance widget with a link and one with `can_query`: link confirmation shows the full URL; a query from
   the widget is refused (no `onRequest`), which is the expected read-only behaviour.
3. Scroll a widget out and back: it stops while off screen, and the cached height keeps the thread from jumping.
4. Run with and without the isolation headers locally: without them the card is shown, never a broken frame.

## References

- <https://core.telegram.org/bots/widgets> — the format, availability and the "unsupported media with its caption" rule.
- <https://github.com/TelegramMessenger/widget-sandbox> — `docs/tgw-format.md` (TL, packing, inflating, state and
  requests), `docs/integration.md` (the host contract, quotas and lifecycle) and `packages/conformance` (the corpus).
- <https://core.telegram.org/constructor/messageMediaUnsupported> — the marker an older layer receives.
