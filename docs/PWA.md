# The progressive web app

The SPA is installable and boots without a network. This is its runbook: what the service worker does, what it must
never do, and how the pieces are built.

## Shape

```
browser ──▶ service worker (apps/web/sw/sw.ts, built by vite-plugin-pwa)
              │  precache: the build's own files (hashed assets, shell, icons, manifest)
              │  navigations: network first, the precached shell as the offline fallback
              └─▶ never touches /user/* or /api/*
```

The worker is registered at the origin's root (`/sw.js`, scope `/`), so it sees every request the page makes. That is
why its rules are written down rather than left to the framework's defaults.

## What is cached, and what is not

| Request                                                                   | Answer                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| The build's own files (hashed assets, the shell, the icons, the manifest) | from the precache, offline included                            |
| A navigation (`/`, `/chat/12`, `/archived`)                               | from the network; the precached shell when the network is gone |
| `/user/*` (the account API, the media, the Access entry point)            | from the network, always; never cached                         |
| `/api/*` (the public health plane)                                        | from the network, always; never cached                         |

**The account plane is never cached.** The engine's data is read live through Cloudflare Access, and a cached
`/user/*` response would put one account's chats in a cache the next reader could reach. Workbox precaches the
build's files and adds no runtime-caching route, so the only thing in the cache is the app's own code.

## The Access rules

`apps/web/sw/routes.ts` holds the rules as pure functions, and `test/pwa/routes.test.ts` asserts them:

- `isPassthroughPath('/user/…')` and `isPassthroughPath('/api/…')` are true. The prefixes are matched on a path
  boundary, so `/usersettings` is the app's own path.
- A navigation to `/user/login` therefore reaches the network and never the shell. This is the rule that matters most:
  `/user/login` is where Cloudflare Access runs its login flow, and answering it with the cached document would
  swallow the redirect — the reader would sit on a landing page with no sign-in.
- Every other navigation falls back to the precached `index.html`, which is the very document Cloudflare Pages serves
  for a pathname route. The offline app therefore boots exactly like the online one — the same reason the repo has no
  `404.html`.

## The build

`vite-plugin-pwa` builds the worker from `apps/web/sw/sw.ts` (`strategies: 'injectManifest'`), injects the precache
manifest, and writes `dist/sw.js`. The rules are ours, in TypeScript, with tests; workbox is the machinery underneath.

The manifest and the icons come from `apps/web/build/pwa/`:

- `mark.ts` holds the mark — the folded paper plane the tab favicon carries — as geometry and as a rasteriser. The
  icons are drawn from it at build time, so the art is one definition rather than a definition plus four binaries.
- `png.ts` is a small PNG encoder (Node's zlib does the deflate); the repo takes no image dependency for four icons.
- `manifest.ts` builds the manifest, used by both the build and the dev server; its `name` and `short_name` are the
  deployment's branding.
- `branding-plugin.ts` writes the product name into the document title.
- `plugin.ts` writes the icons into the bundle and serves the manifest and the icons in development.

The product name lives in `apps/web/branding.ts` and comes from `VITE_APP_NAME` / `VITE_APP_SHORT_NAME` (both default to
`Pigeongram`). The document title, the manifest and the intro read the same values. Continuous deployment passes the
repository variables of the same names; a local build sets them in the environment before
`pnpm --filter @pigeongram/web build`.

`apps/web/public/_headers` gives the worker `Cache-Control: no-cache` (it decides which build the browser runs) and the
hashed assets a year of `immutable`.

## The offline screen

An installed app can be opened with no network, and the app has to say so: the reader is not signed out, the server
is not there. The Access probe and a dead network both fail as a `TypeError` from `fetch` — the first because the
edge redirects to a cross-origin login page, the second because there is no network — so the probe asks the public
`/api/health` endpoint which of the two it is. It answers when the network is up, and the reader is outside the front
door; it fails when the network is gone, and the app shows `OfflineScreen` and waits for the browser's `online` event.

## Development

The worker is **not** registered in development: `import.meta.env.PROD` gates the registration, and
`devOptions.enabled` is off. A worker in the dev server would serve a stale shell over Vite's own modules and break
hot reloading. The dev server still serves the manifest and the icons, so the document's manifest link is not a 404.

## Verifying it

1. `pnpm --filter @pigeongram/web build`, then serve `apps/web/dist/` over HTTP (a service worker needs a
   secure context: `localhost` counts, a plain-HTTP host does not).
2. Chrome DevTools → Application: **Manifest** shows the name, the icons and "Installable"; **Service Workers** shows
   the worker and the precached entries.
3. Application → Service Workers → **Offline** (or DevTools → Network → Offline) and reload: the app shell boots and
   the offline screen appears, because the account API is not reachable.
4. Put the browser back online: the screen retries itself on the `online` event.
5. Install it (the account menu offers "Install app" when the browser raised the prompt) and open the installed app:
   it starts at `/`, which is public, and decides between the intro and the chat list by itself.

## Known limits

- **No push.** The worker never wakes the browser; the Durable Object's live mode is what pushes updates, and it only
  runs while a tab is attached.
- **No offline messages.** Only the shell is cached. Chats, media and history are read live, by design.
- **iOS may open the Access login outside the installed app.** That is how iOS handles a cross-origin navigation from a
  standalone web app, and it is not fixable from here.
- **The worker does not call `skipWaiting`.** A new build's worker waits until the last client of the old one is gone,
  so the update lands on the next fresh load. Skipping the wait would purge the old hashed assets while the open tab
  still runs the old JavaScript.
