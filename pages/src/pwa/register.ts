/**
 * The service worker registration, and the browser's install prompt.
 */

/**
 * The prompt Chromium offers once the client is installable.
 *
 * The event is Chromium's own and is not in the DOM lib, so the part the app
 * uses is declared here.
 */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Registers the app's service worker.
 *
 * Only in a production build: a worker in the dev server would serve a stale
 * shell over Vite's own modules and break hot reloading.
 *
 * The worker is registered at the origin's root, so it controls the whole
 * site — which is why it is careful about what it answers (see `pages/sw/`).
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  const start = (): void => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'classic' }).catch(() => {
      // A failed registration costs the offline shell and nothing else: the
      // app works online, and the browser tries again on the next load.
    });
  };

  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start, { once: true });
  }
}
