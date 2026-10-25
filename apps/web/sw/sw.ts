/// <reference lib="webworker" />

import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { SHELL_URL, isPassthroughPath } from './routes';

/**
 * The app's service worker.
 *
 * It does two things, and deliberately nothing else:
 *
 * 1. It precaches the build's own assets — the hashed scripts and stylesheets,
 *    the shell, the icons — so the app can boot without a network.
 * 2. It answers navigations from the network, and falls back to the precached
 *    shell when the network is gone.
 *
 * It never caches the account API. The engine's data is read live through
 * Cloudflare Access, and a cached `/user/*` response would put one account's
 * chats in a cache the next reader could reach. The rules live in
 * `./routes.ts`, where the tests can assert them.
 */

interface ManifestEntry {
  readonly url: string;
  readonly revision?: string | null;
}

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: ManifestEntry[] };

// The build's own assets. Workbox rewrites this list at build time with the
// hashed file names of the bundle.
precacheAndRoute(self.__WB_MANIFEST);

/**
 * The precached shell, bound to the URL the build precached it under.
 */
const shell = createHandlerBoundToURL(SHELL_URL);

registerRoute(
  new NavigationRoute(async (options) => {
    const { request, url } = options;
    // The API plane never falls back to the shell: `/user/login` is a
    // navigation that has to reach the Cloudflare Access edge, and answering it
    // with the cached document would swallow the redirect.
    if (isPassthroughPath(url.pathname)) return fetch(request);
    try {
      return await fetch(request);
    } catch {
      // The network is gone: the shell is what the app boots from offline.
      return shell(options);
    }
  }),
);
