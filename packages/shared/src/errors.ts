/**
The bridge's machine-readable failure taxonomy.

A caller needs to know whether an attempt was malformed, addressed something
that does not exist, conflicted with the account's state, was refused by
access control, or is worth retrying — not which of a hundred messages was
printed. Both ends of the bridge read this table: the engine derives a code
from an HTTP status, and the SPA derives a status from a code inside a batch
(where the HTTP status of the whole request is always 200).
*/
export type EngineErrorCode =
  | 'validation'
  | 'not_found'
  | 'invite_expired'
  | 'invite_invalid'
  | 'conflict'
  | 'access'
  | 'access_config'
  | 'config'
  | 'rate_limited'
  | 'storage_write_quota'
  | 'upstream'
  | 'unavailable'
  | 'internal';

/**
The status each code stands for at the HTTP boundary.

The entries include the codes the SPA previously mapped to a generic 500:
_access_config_ and a spent write budget are `503`, because the request can
succeed once configuration or the UTC reset passes.
*/
const STATUS_BY_CODE: Readonly<Record<EngineErrorCode, number>> = {
  validation: 400,
  not_found: 404,
  invite_expired: 404,
  invite_invalid: 404,
  conflict: 409,
  access: 403,
  access_config: 503,
  config: 500,
  rate_limited: 429,
  storage_write_quota: 503,
  upstream: 502,
  unavailable: 503,
  internal: 500,
};

/**
The HTTP status a bridge code stands for.
*/
export function statusForCode(code: EngineErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/**
The default code for a status, so call sites need not name it twice.
*/
export function codeForStatus(status: number): EngineErrorCode {
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
