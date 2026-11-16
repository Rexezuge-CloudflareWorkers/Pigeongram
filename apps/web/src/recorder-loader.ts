/**
The lazy door to `opus-recorder`.

The encoder is a WebAssembly worker the recorder only needs once the reader
presses the microphone, so the import belongs behind a function call rather
than at the top of the module: a top-level import would put the encoder in the
first paint's chunk for every reader. Keeping the door in its own module also
gives the SPA's tests one seam to replace, because Vitest cannot intercept a
dynamic import of an external package.
*/
export async function loadOpusRecorder(): Promise<unknown> {
  return import('opus-recorder');
}
