/**
 * The engine's numeric policy, read from the environment once.
 *
 * Every bound the bridge enforces lives here so a wake, an upload parser and
 * a ranged media read all agree on the same value. The environment is read at
 * the engine's construction (and once at the edge for the upload pre-flight),
 * never inside a request handler.
 */

/**
 * The alarm cadence when `WAKE_INTERVAL_SECONDS` is absent or unusable.
 */
export const DEFAULT_WAKE_INTERVAL_SECONDS = 300;

/**
 * The floor for `WAKE_INTERVAL_SECONDS`: a smaller cadence spends the Free
 * plan's row budget on `setAlarm` without making the account more reachable.
 */
const MIN_WAKE_INTERVAL_SECONDS = 30;

/**
 * The largest upload when `UPLOAD_MAX_BYTES` is absent or unusable.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Telegram's ranged-download part block. mtcute fetches 128 KB–1 MB parts
 * from the offset without the `precise` flag, and Telegram requires every part
 * to stay inside one 1 MB block; a finer alignment lets the first part cross
 * the boundary and fail with `LIMIT_INVALID`. This is a protocol constant, not
 * a deployment knob — it lives here with the other windows.
 */
export const MEDIA_WINDOW_BYTES = 1024 * 1024;

export interface EngineConfig {
  /**
   * The alarm cadence, after the floor and fallback have been applied.
   */
  readonly wakeIntervalSeconds: number;
  /**
   * The same cadence in milliseconds, for `setAlarm`.
   */
  readonly wakeIntervalMs: number;
  /**
   * The largest single upload, or album total, in bytes.
   */
  readonly maxUploadBytes: number;
  /**
   * The part-block size ranged media downloads align to.
   */
  readonly mediaWindowBytes: number;
}

/**
 * The slice of the config the upload parsers need. A caller that only parses a
 * query string can pass the full config; a test can pass the one bound it cares
 * about.
 */
export type UploadConfig = Pick<EngineConfig, 'maxUploadBytes'>;

/**
 * The environment fields the engine's bounds read. Both are optional because a
 * deployment may omit either and get the default.
 */
export interface EngineEnv {
  readonly WAKE_INTERVAL_SECONDS?: string;
  readonly UPLOAD_MAX_BYTES?: string;
}

/**
 * Reads the engine's bounds, falling back to the documented defaults.
 *
 * A var is used only when it parses to a number the engine can act on; a
 * malformed value is treated as absent rather than failing every request.
 */
export function readEngineConfig(env: EngineEnv): EngineConfig {
  const wakeIntervalSeconds = readWakeIntervalSeconds(env);
  return {
    wakeIntervalSeconds,
    wakeIntervalMs: Math.round(wakeIntervalSeconds * 1000),
    maxUploadBytes: readMaxUploadBytes(env),
    mediaWindowBytes: MEDIA_WINDOW_BYTES,
  };
}

function readWakeIntervalSeconds(env: EngineEnv): number {
  const parsed = Number(env.WAKE_INTERVAL_SECONDS ?? '');
  return Number.isFinite(parsed) && parsed >= MIN_WAKE_INTERVAL_SECONDS ? parsed : DEFAULT_WAKE_INTERVAL_SECONDS;
}

function readMaxUploadBytes(env: EngineEnv): number {
  const parsed = Number(env.UPLOAD_MAX_BYTES ?? '');
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_MAX_UPLOAD_BYTES;
}
