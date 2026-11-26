import { describe, expect, it, vi } from 'vitest';

/**
The lazy door to the WebAssembly encoder.

A top-level import would put the encoder in the first paint, so the module is
a single dynamic import. The test asserts the door exists and hands back the
real package shape; the recorder itself is covered by its own tests.
*/
vi.mock('opus-recorder', () => ({ default: class FakeEncoder {} }));

describe('loadOpusRecorder', () => {
  it('resolves the encoder on demand', async () => {
    const { loadOpusRecorder } = await import('../../apps/web/src/recorder-loader');
    const encoder = (await loadOpusRecorder()) as { default: unknown };
    expect(encoder.default).toBeDefined();
  });
});
