import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineWebViteConfig } from '@rexezuge/tooling/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readBranding } from './branding';
import { pwaAssetLinksPlugin } from './build/pwa/assetlinks-plugin';
import { pwaBrandingPlugin } from './build/pwa/branding-plugin';
import { createManifest } from './build/pwa/manifest';
import { pwaIconsPlugin } from './build/pwa/plugin';

/**
 * The SPA's Vite config, on the kit's factory.
 *
 * The dev proxy points at the worker's local port (`wrangler dev` default
 * 8787). `spaShell` is deliberately not passed: this repo's worker is API-only
 * and serves no embedded shell — the Pages project is the whole front end.
 */
const branding = readBranding(process.env);

export default defineWebViteConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The product name in the document title (`VITE_APP_NAME`).
    pwaBrandingPlugin(branding),
    // The icons the manifest points at, drawn from the favicon's own geometry.
    pwaIconsPlugin(branding),
    // The Digital Asset Links statement for this deployment's Android build.
    // It is emitted only when the deployment supplies the Android variables.
    pwaAssetLinksPlugin(),
    VitePWA({
      // The worker is ours (`pages/sw/sw.ts`), so the rules that keep the
      // Cloudflare Access gate intact are readable TypeScript with tests,
      // not a workbox configuration.
      strategies: 'injectManifest',
      srcDir: 'sw',
      filename: 'sw.ts',
      // The app registers the worker itself (`pages/src/pwa/register.ts`), so
      // the plugin does not inject a registration script.
      injectRegister: null,
      // A worker in the dev server would serve a stale shell over Vite's own
      // modules and break hot reloading.
      devOptions: { enabled: false },
      manifest: createManifest(branding),
      injectManifest: {
        // The build's own files: the hashed assets, the shell, the icons and
        // the manifest. Nothing else is ever precached.
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  proxy: {
    // The public plane is health only and needs no WebSocket forwarding.
    '/api': { target: 'http://localhost:8787', changeOrigin: true },
    // `ws: true` is load-bearing: the SPA dials the updates socket at
    // `ws://<dev host>/user/updates`, and Vite only forwards the upgrade when
    // WebSocket proxying is enabled.
    '/user': { target: 'http://localhost:8787', changeOrigin: true, ws: true },
  },
});
