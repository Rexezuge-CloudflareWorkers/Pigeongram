import type { RecorderConstructor, RecorderInstance } from 'opus-recorder';
import { loadOpusRecorder } from './recorder-loader';
import { VOICE_MAX_SECONDS } from './types';

/**
The browser's half of a voice message: opening the microphone, encoding the
capture to the Ogg/Opus container Telegram's own clients expect, and handing
back a `File` the existing upload route accepts.

`opus-recorder` is loaded lazily, on the first press of the microphone button,
so the encoder's WebAssembly bundle is not part of the first paint. The
recorder is a short-lived object: one recording, one close. Nothing here talks
to the bridge; the outbox owns the upload.
*/

const VOICE_MIME = 'audio/ogg';
const VOICE_FILE_NAME = 'voice-message.ogg';

/**
The worker script the SPA build copies to the bundle. Its WebAssembly encoder
is embedded in the script as a data URI, so the worker is the only file.
*/
const ENCODER_PATH = '/recorder/encoderWorker.min.js';

/**
`opus-recorder`'s voice application: the encoder's speech tuning, the same
mode Telegram's own clients record in.
*/
const VOICE_ENCODER_APPLICATION = 2048;

/**
A recording that ended, ready to upload. `duration` is measured from the
encoder's own sample position, rounded to the whole seconds the bridge stores.
*/
export interface RecordedVoice {
  file: File;
  duration: number;
}

/**
An open microphone. The caller either `stop`s it (a voice message) or
`cancel`s it (nothing is sent); both release the capture.
*/
export interface VoiceRecording {
  /**
   * Seconds captured so far, for the composer's timer.
   */
  seconds(): number;
  /**
   * Ends the capture and resolves with the encoded file, or `null` when the
   * encoder produced nothing.
   */
  stop(): Promise<RecordedVoice | null>;
  /**
   * Ends the capture and discards it.
   */
  cancel(): void;
}

/**
A refusal the reader can act on: no permission, no device, or a browser
without the pieces the encoder needs. The messages are shown as written.
*/
class VoiceRecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceRecordingError';
  }
}

interface RecorderModule {
  default?: unknown;
}

/**
Loads the encoder only when it is needed, and refuses a browser the library
itself says cannot record.
*/
async function loadRecorder(): Promise<RecorderConstructor> {
  let module: RecorderModule;
  try {
    module = (await loadOpusRecorder()) as RecorderModule;
  } catch {
    throw new VoiceRecordingError("Voice Recording Isn't Supported In This Browser.");
  }
  const Recorder = module.default as RecorderConstructor | undefined;
  if (typeof Recorder !== 'function' || !Recorder.isRecordingSupported()) {
    throw new VoiceRecordingError("Voice Recording Isn't Supported In This Browser.");
  }
  return Recorder;
}

/**
Opens the microphone and starts encoding. Resolves once the capture is live,
so the composer only shows its recording state after the permission prompt has
been answered.
*/
export async function startVoiceRecording(): Promise<VoiceRecording> {
  const Recorder = await loadRecorder();
  const chunks: Uint8Array[] = [];
  let recorder: RecorderInstance;
  try {
    recorder = new Recorder({
      encoderPath: ENCODER_PATH,
      encoderApplication: VOICE_ENCODER_APPLICATION,
      numberOfChannels: 1,
      encoderSampleRate: 48_000,
      streamPages: false,
    });
  } catch {
    throw new VoiceRecordingError("Voice Recording Isn't Supported In This Browser.");
  }
  recorder.ondataavailable = (data) => {
    chunks.push(data);
  };

  let startedAt = 0;
  try {
    await recorder.start();
    startedAt = now();
  } catch (error) {
    close(recorder);
    throw microphoneError(error);
  }

  let active = true;
  return {
    seconds(): number {
      if (!active) return 0;
      return Math.min(VOICE_MAX_SECONDS, Math.floor((now() - startedAt) / 1000));
    },
    cancel(): void {
      if (!active) return;
      active = false;
      void recorder
        .stop()
        .then(() => close(recorder))
        .catch(() => close(recorder));
    },
    async stop(): Promise<RecordedVoice | null> {
      if (!active) return null;
      active = false;
      // `onstop` runs after the encoder's final page has been delivered, so
      // the collected chunks are complete when it fires.
      const finished = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      try {
        await recorder.stop();
        await finished;
      } catch {
        close(recorder);
        return null;
      }
      const duration = Math.min(VOICE_MAX_SECONDS, Math.max(1, Math.round(recorder.encodedSamplePosition / 48_000)));
      const bytes = concat(chunks);
      close(recorder);
      if (bytes.length === 0) return null;
      // The Blob part is a plain ArrayBuffer: a typed-array view's buffer is
      // typed as possibly shared, which `BlobPart` does not accept.
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return { file: new File([buffer], VOICE_FILE_NAME, { type: VOICE_MIME }), duration };
    },
  };
}

/**
The composer's timer, `m:ss`.
*/
export function elapsedLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes)}:${rest.toString().padStart(2, '0')}`;
}

function now(): number {
  return typeof globalThis.performance?.now === 'function' ? performance.now() : Date.now();
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function close(recorder: RecorderInstance): void {
  try {
    recorder.close();
  } catch {
    // A recorder that never opened its audio context has nothing to release.
  }
}

/**
Turns the browser's capture failure into the sentence the reader sees.
*/
function microphoneError(error: unknown): VoiceRecordingError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return new VoiceRecordingError('Microphone Access Was Denied.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new VoiceRecordingError('No Microphone Was Found.');
  }
  return new VoiceRecordingError('The Microphone Could Not Be Started.');
}
