/**
Prebuild the widget sandbox's two in-page bundles.

The sandbox ships raw TypeScript in `node_modules`, which Vite cannot load
from its config: Node refuses to strip types for files under `node_modules`,
and Vite's `--configLoader runner` closes the runner before the sandbox's
esbuild plugin makes its dynamic imports. Running this small entry with
`tsx` (which transpiles those files itself) sidesteps both problems. The
output is gitignored and read by our local Vite plugin at build and dev time.
*/

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rendererBuildOptions, sandboxBuildOptions } from '@telegram/widget-sandbox/build';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const buildScript = require.resolve('@telegram/widget-sandbox/build');
const packageRoot = path.resolve(path.dirname(buildScript), '..');
const outputDirectory = path.join(here, 'generated');

fs.mkdirSync(outputDirectory, { recursive: true });

for (const [name, options] of [
  ['sandbox-bundle', sandboxBuildOptions(packageRoot)],
  ['renderer-bundle', rendererBuildOptions(packageRoot)],
] as const) {
  const result = await build(options);
  const code = result.outputFiles?.[0]?.text;
  if (code === undefined) throw new Error(`${name}: esbuild produced no output`);
  fs.writeFileSync(path.join(outputDirectory, `${name}.js`), `export default ${JSON.stringify(code)};\n`);
}

console.log('Widget sandbox bundles written to apps/web/build/generated');
