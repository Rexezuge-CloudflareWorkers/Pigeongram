# The browser cache

The SPA keeps a small, disposable projection of account data in IndexedDB so a reload paints the chat list and a reopened chat without waiting for a bridge read. The engine remains the truth: a cached value is a **paint**, never an answer. The boot read and the socket's replayed updates still settle what the reader actually sees.

This follows the pattern of the official Telegram clients — Desktop, Web K and Android all read dialogs, per-chat message windows, entities and sticker sets from a local store, then catch up from the server. The difference is that the Durable Object already owns `updates.getDifference` and the update cursor, so the browser does not run a second sync engine. It only reads a projection.

## What is stored

| Store      | Key            | Value                                | TTL  |
| ---------- | -------------- | ------------------------------------ | ---- |
| `meta`     | `meta`         | running byte total and schema        | —    |
| `dialogs`  | `snapshot`     | main list, archive, `me`, saved time | 24 h |
| `threads`  | marked chat id | one sanitised `ChatThread` window    | 7 d  |
| `profiles` | marked chat id | one `ProfileDto`                     | 1 d  |
| `stickers` | `library`      | `StickerLibraryDto`                  | 1 d  |

A thread entry keeps at most 200 messages and drops the fields that belong to a live open — `newMessageIds` and `focusMessageId`. Only a window that reaches the chat's newest message and has no focus anchor is stored, reusing `cacheableThread` in `apps/web/src/thread-cache.ts`.

Media is **not** in this store. `/user/file`, `/user/avatar` and `/user/sticker` already answer with `Cache-Control: private, max-age=86400` and an `ETag`, so the browser's own HTTP cache handles avatars, thumbnails and stickers. The service worker still never caches `/user/*`; see [PWA.md](PWA.md).

## Read and write path

- **Boot** (`SignedInShell`): when the cached snapshot's `me.id` matches the account the Access probe named, the sidebar paints from it first. `fetchBootstrap()` runs in the background and replaces it. A mismatch drops the snapshot, so a second Access identity never sees the first one's chats.
- **Thread open** (`useThreadOpen`): the in-memory `ThreadCache` is L1 (instant within a session); IndexedDB is L2 (a fresh load). Both go through `cachedOpen()`, which refuses an unread chat, a linked-post jump and a window more than one opening page behind the dialog. `mergeCacheRefresh()` folds the newest page into whatever was painted.
- **Profiles** (`useProfile`) and the **sticker library** (`StickerPicker`) read the store before the bridge and write after a successful read.

Writes are debounced (500 ms) from `useDialogs.commit` and the thread effect, so a live burst does not write a row per message. Every read touches the entry's access time for LRU. All writes are best effort: a quota error, a private window or a corrupt record costs only the faster paint.

## Size and eviction

The reader chooses a cap in **Settings → Storage**: Off, 25, 50, 100, 250 or 500 MB, default 100 MB. The choice is a device preference in `localStorage`, like the theme and data-saver switches. Off disables IndexedDB persistence; the in-memory thread cache still works because it uses no disk.

When the running total passes the cap, entries fall out in this order: **stickers → profiles → threads (least recently used first) → dialogs**. Dialogs go last because they are what makes the shell paint. Shrinking the cap prunes immediately; turning it off purges everything.

`navigator.storage.estimate()` is the browser's own hard limit behind this soft cap.

## Scope and privacy

- The cache is scoped to the browser profile and the account id. A logout, an owner mismatch, a schema bump or an Access `401/403` drops it.
- Clearing it from Settings removes only these projections. It does **not** sign out, remove the Web Push subscription (that lives in the engine) or clear the browser's media cache.
- The data is not encrypted at rest. It holds chat previews and message text, which is why hydration waits for Access and why there is no offline read mode: the `OfflineScreen` is still the answer when the network is gone.
- Two tabs can write the same entry. Last writer wins; a reload recomputes the byte total from the stored records.

The policy is pure and lives in `apps/web/src/cache/policy.ts`; the IndexedDB seam is `apps/web/src/cache/db.ts`; the high-level API and `resetCache()` test seam are in `apps/web/src/cache/index.ts`.

## Tests

`test/web/cache.test.ts` covers the byte accounting, shape validation, eviction order, the IndexedDB adapter, read/write round trips, corrupt record recovery, the Off setting, pruning, purging and the Settings hook. jsdom has no IndexedDB, so that file installs `fake-indexeddb` itself; the rest of the SPA suite sees no `indexedDB` and takes the synchronous no-cache path.
