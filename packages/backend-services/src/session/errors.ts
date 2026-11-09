import { ServiceError } from '@rexezuge/errors';

/**
 * The machine-readable half of a bridge failure.
 *
 * The codes are deliberately coarse: a caller needs to know whether an
 * attempt was malformed, addressed something that does not exist, conflicted
 * with the account's state, was refused by access control, or is worth
 * retrying — not which of a hundred messages was printed.
 */
export type EngineErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'access'
  | 'access_config'
  | 'config'
  | 'storage_write_quota'
  | 'upstream'
  | 'unavailable'
  | 'internal';

/**
An error the engine maps onto an HTTP status for the bridge.

It extends the family's `ServiceError`, so the worker edge, the Durable Object
and the SPA all branch on one taxonomy. `type` carries the coarse bridge code
rather than the SDK class name — a caller keys on `not_found`, not on
`EngineError` — and `expose` is always on because every engine message is
written for the client. An unknown failure never becomes an `EngineError`; the
boundary maps it to the masked `internal` response.
*/
export class EngineError extends ServiceError {
  constructor(message: string, status = 400, code: EngineErrorCode = codeForStatus(status)) {
    super(status, code, message, { expose: true });
    this.name = 'EngineError';
  }

  /**
   * The bridge code as its narrowed type.
   *
   * `ServiceError.type` is a plain string so a subclass can name any stable
   * code; this getter gives the engine's own callers the union back without a
   * cast at every `failure.code` read.
   */
  get code(): EngineErrorCode {
    return this.type as EngineErrorCode;
  }
}

/**
 * The default code for a status, so existing `new EngineError(message, status)`
 * call sites get a useful classification without repeating it.
 */
function codeForStatus(status: number): EngineErrorCode {
  switch (status) {
    case 401:
    case 403: {
      return 'access';
    }
    case 404: {
      return 'not_found';
    }
    case 409: {
      return 'conflict';
    }
    case 502: {
      return 'upstream';
    }
    case 503:
    case 504: {
      return 'unavailable';
    }
    default: {
      return status >= 400 && status < 500 ? 'validation' : 'internal';
    }
  }
}

/**
The readable form of the Free plan's daily row-write failure.
*/
export const STORAGE_WRITE_QUOTA_MESSAGE = 'Durable Object storage write quota exhausted; it resets at 00:00 UTC. Reads still work.';

/**
The runtime's own wording for the exhausted daily row budget.
*/
const STORAGE_WRITE_QUOTA_PATTERN = /Exceeded allowed rows written in Durable Objects free tier/i;
const MAX_CAUSE_DEPTH = 8;

/**
Only an `Error` carries the runtime's wording; a thrown string is the other shape this boundary accepts.
*/
function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === 'string' ? value : '';
}

/**
Whether a failure is the Free plan refusing another row write.

The runtime's own wording is matched through the whole `cause` chain: mtcute
and the storage adapter wrap the runtime error before it reaches the bridge, so
the quota sentence is usually one level down rather than on the value that was
caught. A bounded walk keeps a cyclic `cause` from looping.
*/
export function isStorageWriteQuotaError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (current === undefined || current === null || seen.has(current)) return false;
    seen.add(current);
    if (STORAGE_WRITE_QUOTA_PATTERN.test(errorMessage(current))) return true;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
