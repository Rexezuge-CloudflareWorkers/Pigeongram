import { describe, expect, it } from 'vitest';
import { RECORDER_ASSETS, readRecorderAssets, voiceRecorderPlugin } from '../../apps/web/build/recorder-plugin';

/**
The voice recorder's encoder is one worker script, copied out of
`opus-recorder` rather than committed. Its WebAssembly binary is embedded in
the script as a data URI, so there is no sibling `.wasm` file. These cases
pin that the build carries the script and that its path matches the one
`recorder.ts` names.
*/

interface EmittedAsset {
  type: 'asset';
  fileName: string;
  source: Uint8Array;
}

type GenerateBundleHook = (this: { emitFile: (file: EmittedAsset) => void }, options: unknown, bundle: unknown, isWrite: boolean) => void;

function runPlugin(): EmittedAsset[] {
  const emitted: EmittedAsset[] = [];
  const hook = voiceRecorderPlugin().generateBundle;
  if (typeof hook !== 'function') throw new TypeError('voiceRecorderPlugin has no generateBundle hook');
  (hook as GenerateBundleHook).call({ emitFile: (file) => emitted.push(file) }, {}, {}, false);
  return emitted;
}

describe('readRecorderAssets', () => {
  it('reads the encoder worker from the installed package', () => {
    const assets = readRecorderAssets();

    expect(assets.map((asset) => asset.fileName)).toEqual(['recorder/encoderWorker.min.js']);
    expect(RECORDER_ASSETS).toEqual(['encoderWorker.min.js']);
    expect(assets[0]!.source.byteLength).toBeGreaterThan(0);
    // The encoder's wasm is embedded, so the script has to carry its data URI.
    expect(Buffer.from(assets[0]!.source).toString('utf8')).toContain('data:application/octet-stream;base64,');
  });

  it('emits the worker into the bundle', () => {
    const emitted = runPlugin();

    expect(emitted.map((asset) => asset.fileName)).toEqual(['recorder/encoderWorker.min.js']);
    expect(emitted[0]!.type).toBe('asset');
  });
});
