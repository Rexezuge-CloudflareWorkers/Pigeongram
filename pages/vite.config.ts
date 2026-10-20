import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineWebViteConfig } from '@rexezuge/tooling/vite';

/**
 * The SPA's Vite config, on the kit's factory.
 *
 * The dev proxy points at the worker's local port (`wrangler dev` default
 * 8787). `spaShell` is deliberately not passed: this repo's worker is API-only
 * and serves no embedded shell — the Pages project is the whole front end.
 */
export default defineWebViteConfig({
  plugins: [react(), tailwindcss()],
  proxy: {
    // The public plane is health only and needs no WebSocket forwarding.
    '/api': { target: 'http://localhost:8787', changeOrigin: true },
    // `ws: true` is load-bearing: the SPA dials the updates socket at
    // `ws://<dev host>/user/updates`, and Vite only forwards the upgrade when
    // WebSocket proxying is enabled.
    '/user': { target: 'http://localhost:8787', changeOrigin: true, ws: true },
  },
});
