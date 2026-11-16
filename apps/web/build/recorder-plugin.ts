import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
The encoder worker the voice recorder loads on demand.

`opus-recorder` keeps its WebAssembly encoder in a single worker script: the
binary is embedded in it as a data URI, so there is no sibling `.wasm` file to
serve. The package cannot be bundled either — the worker is loaded by the
recorder at runtime, not imported by the app — so this plugin copies the script
out of `node_modules` into `recorder/`, for the build and for the dev server,
which serves no build.
*/

/**
The file the recorder needs, in `opus-recorder`'s `dist` directory.
*/
export const RECORDER_ASSETS = ['encoderWorker.min.js'] as const;

/**
Where the SPA serves it. `recorder.ts` names the worker at `/recorder/…`,
which is `RECORDER_ROUTE` with a leading slash.
*/
const RECORDER_ROUTE = 'recorder';

export interface RecorderAsset {
  fileName: string;
  source: Uint8Array;
}

/**
Reads the asset from the installed package, so a dependency bump carries the
worker along instead of leaving a stale copy in the repository.
*/
export function readRecorderAssets(): RecorderAsset[] {
  const require = createRequire(import.meta.url);
  const dist = path.join(path.dirname(require.resolve('opus-recorder/package.json')), 'dist');
  return RECORDER_ASSETS.map((name) => ({ fileName: `${RECORDER_ROUTE}/${name}`, source: readFileSync(path.join(dist, name)) }));
}

export function voiceRecorderPlugin(): Plugin {
  return {
    name: 'voice-recorder',
    generateBundle() {
      for (const asset of readRecorderAssets()) {
        this.emitFile({ type: 'asset', fileName: asset.fileName, source: asset.source });
      }
    },
    configureServer(server) {
      const assets = readRecorderAssets();
      server.middlewares.use((request, response, next) => {
        const requestPath = (request.url ?? '').split('?', 1)[0] ?? '';
        const asset = assets.find((candidate) => `/${candidate.fileName}` === requestPath);
        if (asset === undefined) {
          next();
          return;
        }
        response.setHeader('content-type', 'text/javascript');
        response.end(Buffer.from(asset.source));
      });
    },
  };
}
