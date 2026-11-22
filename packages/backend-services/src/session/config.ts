/**
The engine's numeric policy, read from the environment once.

Every bound the bridge enforces lives here so a wake, an upload parser and
a ranged media read all agree on the same value. The environment is read at
the engine's construction (and once at the edge for the upload pre-flight),
never inside a request handler.
*/

import { EnvParser } from '@pigeongram/backend-runtime/config';

/**
The alarm cadence when `WAKE_INTERVAL_SECONDS` is absent or unusable.
*/
export const DEFAULT_WAKE_INTERVAL_SECONDS = 300;

/**
The floor for `WAKE_INTERVAL_SECONDS`: a smaller cadence spends the Free
plan's row budget on `setAlarm` without making the account more reachable.
*/
const MIN_WAKE_INTERVAL_SECONDS = 30;

/**
The largest upload when `UPLOAD_MAX_BYTES` is absent or unusable.
*/
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
Telegram's ranged-download part block, and the upper bound on the part a
ranged media response aligns to.

Telegram requires every part to stay inside one 1 MB block; a finer
alignment lets a part cross the boundary and fail with `LIMIT_INVALID`. The
exact part size is chosen per file (`media-window.ts`), so a seek into a
video under 250 MB aligns to a 128 KB part instead of wasting the rest of a
block. This is a protocol constant, not a deployment knob — it lives here
with the other windows.
*/
export const MEDIA_WINDOW_BYTES = 1024 * 1024;

export interface EngineConfig {
  /**
  The alarm cadence, after the floor and fallback have been applied.
  */
  readonly wakeIntervalSeconds: number;
  /**
  The same cadence in milliseconds, for `setAlarm`.
  */
  readonly wakeIntervalMs: number;
  /**
  The largest single upload, or album total, in bytes.
  */
  readonly maxUploadBytes: number;
  /**
  The upper bound on the part size ranged media downloads align to.
  */
  readonly mediaWindowBytes: number;
}

/**
The slice of the config the upload parsers need. A caller that only parses a
query string can pass the full config; a test can pass the one bound it cares
about.
*/
export type UploadConfig = Pick<EngineConfig, 'maxUploadBytes'>;

/**
The environment fields the engine's bounds read. Both are optional because a
deployment may omit either and get the default.
*/
export interface EngineEnv {
  readonly WAKE_INTERVAL_SECONDS?: string;
  readonly UPLOAD_MAX_BYTES?: string;
}

/**
Reads the engine's bounds, falling back to the documented defaults.

A var is used only when it parses to a number the engine can act on; a
malformed value is treated as absent rather than failing every request.
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
  // `EnvParser.readString` keeps the raw value: the cadence may be fractional
  // (`30.5`), which the integer readers would reject even though `setAlarm`
  // accepts it.
  const parsed = Number(EnvParser.readString(env, 'WAKE_INTERVAL_SECONDS') ?? '');
  return Number.isFinite(parsed) && parsed >= MIN_WAKE_INTERVAL_SECONDS ? parsed : DEFAULT_WAKE_INTERVAL_SECONDS;
}

function readMaxUploadBytes(env: EngineEnv): number {
  // Fractional byte counts are floored rather than rejected, so a deployment
  // that sets `1048576.5` still gets the cap it meant.
  const parsed = Number(EnvParser.readString(env, 'UPLOAD_MAX_BYTES') ?? '');
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_MAX_UPLOAD_BYTES;
}
