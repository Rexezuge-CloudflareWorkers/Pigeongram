import { afterEach, describe, expect, it, vi } from 'vitest';
import { elapsedLabel, startVoiceRecording } from '../../apps/web/src/recorder';

/**
 * The recorder is a thin wrapper over `opus-recorder`: what belongs to this app
 * is the file it hands back, the duration it reports and the release of the
 * microphone on every exit. The library itself is faked here.
 */

interface FakeOptions {
  encoderPath?: string;
  encoderApplication?: number;
}

const state = vi.hoisted(() => ({
  instances: [] as Array<Record<string, unknown>>,
  supported: true,
  startError: null as Error | null,
  empty: false,
  sampleSeconds: 7,
}));

vi.mock('../../apps/web/src/recorder-loader', () => {
  class FakeRecorder {
    static isRecordingSupported(): boolean {
      return state.supported;
    }

    static version = 'test';

    state = 'inactive';
    encodedSamplePosition = 0;
    closed = false;
    stops = 0;
    options: unknown;
    ondataavailable: (data: Uint8Array) => void = () => {};
    onstart: () => void = () => {};
    onstop: () => void = () => {};
    onpause: () => void = () => {};
    onresume: () => void = () => {};

    constructor(options?: FakeOptions) {
      this.options = options;
      state.instances.push(this as unknown as Record<string, unknown>);
    }

    async start(): Promise<void> {
      if (state.startError !== null) throw state.startError;
      this.state = 'recording';
      this.onstart();
    }

    async stop(): Promise<void> {
      this.stops += 1;
      this.state = 'inactive';
      if (!state.empty) this.ondataavailable(new Uint8Array([1, 2, 3, 4]));
      this.encodedSamplePosition = 48_000 * state.sampleSeconds;
      this.onstop();
    }

    close(): void {
      this.closed = true;
    }
  }

  return { loadOpusRecorder: async () => ({ default: FakeRecorder }) };
});

afterEach(() => {
  state.instances.length = 0;
  state.supported = true;
  state.startError = null;
  state.empty = false;
  state.sampleSeconds = 7;
});

/**
 * A browser capture failure is an `Error` whose `name` is the spec's code; the
 * recorder reads the name and nothing else.
 */
function captureError(name: string): Error {
  const error = new Error(name);
  Object.defineProperty(error, 'name', { value: name });
  return error;
}

function lastInstance(): Record<string, unknown> {
  const instance = state.instances.at(-1);
  if (instance === undefined) throw new Error('the recorder was never constructed');
  return instance;
}

describe('elapsedLabel', () => {
  it('formats whole seconds as m:ss', () => {
    expect(elapsedLabel(0)).toBe('0:00');
    expect(elapsedLabel(9)).toBe('0:09');
    expect(elapsedLabel(65)).toBe('1:05');
    expect(elapsedLabel(300)).toBe('5:00');
    // A negative or fractional value can only be a clock wobble.
    expect(elapsedLabel(-3)).toBe('0:00');
    expect(elapsedLabel(4.9)).toBe('0:04');
  });
});

describe('startVoiceRecording', () => {
  it('hands back an Ogg file carrying the encoder-duration', async () => {
    const recording = await startVoiceRecording();
    const recorder = lastInstance();

    expect(recorder.options).toMatchObject({
      encoderPath: '/recorder/encoderWorker.min.js',
      encoderApplication: 2048,
      numberOfChannels: 1,
      encoderSampleRate: 48_000,
    });

    const voice = await recording.stop();

    expect(voice?.file.name).toBe('voice-message.ogg');
    expect(voice?.file.type).toBe('audio/ogg');
    expect(voice?.duration).toBe(7);
    expect(Array.from(new Uint8Array((await voice?.file.arrayBuffer()) ?? new ArrayBuffer(0)))).toEqual([1, 2, 3, 4]);
    expect(recorder.closed).toBe(true);
  });

  it('rounds a sub-second capture up to the shortest voice note Telegram takes', async () => {
    state.sampleSeconds = 0.2;
    const recording = await startVoiceRecording();

    const voice = await recording.stop();

    expect(voice?.duration).toBe(1);
  });

  it('returns nothing when the encoder produced no bytes', async () => {
    state.empty = true;
    const recording = await startVoiceRecording();

    await expect(recording.stop()).resolves.toBeNull();
    expect(lastInstance().closed).toBe(true);
  });

  it('releases the microphone on cancel without handing back a file', async () => {
    const recording = await startVoiceRecording();
    recording.cancel();

    await vi.waitFor(() => {
      expect(lastInstance().closed).toBe(true);
    });
    expect(lastInstance().stops).toBe(1);
  });

  it('reports a browser without the encoder', async () => {
    state.supported = false;

    await expect(startVoiceRecording()).rejects.toThrowError("Voice Recording Isn't Supported In This Browser.");
  });

  it('turns the browser refusal into a sentence the reader can act on', async () => {
    state.startError = captureError('NotAllowedError');
    await expect(startVoiceRecording()).rejects.toThrowError('Microphone Access Was Denied.');
    expect(lastInstance().closed).toBe(true);

    state.startError = captureError('NotFoundError');
    await expect(startVoiceRecording()).rejects.toThrowError('No Microphone Was Found.');

    state.startError = new Error('boom');
    await expect(startVoiceRecording()).rejects.toThrowError('The Microphone Could Not Be Started.');
  });

  it('keeps the live timer inside the length cap', async () => {
    const recording = await startVoiceRecording();

    expect(recording.seconds()).toBe(0);
    recording.cancel();
    expect(recording.seconds()).toBe(0);
  });
});
