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
*/
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code: EngineErrorCode = codeForStatus(status),
  ) {
    super(message);
    this.name = 'EngineError';
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
Whether a failure is the Free plan refusing another row write.

The runtime's own wording is matched loosely: the error may be wrapped by
mtcute or by the storage adapter before it reaches the bridge.
*/
export function isStorageWriteQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Exceeded allowed rows written in Durable Objects free tier');
}
