/**
 * The slice of `opus-recorder` this app uses.
 *
 * The package ships no types of its own, and it is loaded lazily by
 * `recorder.ts` the first time the reader asks for the microphone, so a local
 * declaration is enough: only the constructor, the lifecycle methods and the
 * data callback are named here.
 */
declare module 'opus-recorder' {
  export interface RecorderOptions {
    /**
     * URL of the encoder worker script. Its WebAssembly binary is embedded in
     * the script, so the build copies that one file to `/recorder/`.
     */
    encoderPath?: string;
    bufferLength?: number;
    mediaTrackConstraints?: boolean | MediaTrackConstraints;
    monitorGain?: number;
    numberOfChannels?: number;
    recordingGain?: number;
    encoderApplication?: number;
    encoderBitRate?: number;
    encoderComplexity?: number;
    encoderFrameSize?: number;
    encoderSampleRate?: number;
    maxFramesPerPage?: number;
    resampleQuality?: number;
    streamPages?: boolean;
  }

  export interface RecorderInstance {
    state: 'inactive' | 'loading' | 'recording' | 'paused';
    /**
     * Samples encoded so far, at the encoder's 48 kHz rate. The finished
     * recording's duration is this divided by 48000.
     */
    encodedSamplePosition: number;
    ondataavailable: (data: Uint8Array) => void;
    onstart: () => void;
    onstop: () => void;
    onpause: () => void;
    onresume: () => void;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    pause: (flush?: boolean) => Promise<void>;
    resume: () => void;
    close: () => void;
  }

  export interface RecorderConstructor {
    new (options?: RecorderOptions): RecorderInstance;
    isRecordingSupported: () => boolean;
    version: string;
  }

  const Recorder: RecorderConstructor;
  export default Recorder;
}
