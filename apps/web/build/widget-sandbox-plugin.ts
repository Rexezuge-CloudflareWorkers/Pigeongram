import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
Serves the sandbox's prebuilt in-page bundles and sets the development
server's cross-origin isolation headers.

The bundles are written by `widget-sandbox-bundles.ts` before dev/build, so
this plugin only reads local generated files — no raw TypeScript from
`node_modules` is imported while Vite loads its config. Production gets the
same three headers from `apps/web/public/_headers`.
*/

export const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const BUNDLES: Record<string, string> = {
  'virtual:sandbox-bundle': 'sandbox-bundle.js',
  'virtual:renderer-bundle': 'renderer-bundle.js',
};

const generated = path.join(path.dirname(fileURLToPath(import.meta.url)), 'generated');

export function widgetSandboxBundles(): Plugin {
  return {
    name: 'widget-sandbox-bundles',
    config: () => ({
      // The sandbox worker is built from its own sources, not our workspace.
      worker: { format: 'es' },
      optimizeDeps: { exclude: ['@telegram/widget-sandbox-quickjs'] },
      server: { headers: ISOLATION_HEADERS },
      preview: { headers: ISOLATION_HEADERS },
    }),
    resolveId(id) {
      return id in BUNDLES ? `\0${id}` : undefined;
    },
    load(id) {
      if (!id.startsWith('\0')) return;
      const file = BUNDLES[id.slice(1)];
      if (file === undefined) return;
      const source = fs.readFileSync(path.join(generated, file), 'utf8');
      return { code: source, map: null };
    },
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        for (const [name, value] of Object.entries(ISOLATION_HEADERS)) response.setHeader(name, value);
        next();
      });
    },
  };
}
