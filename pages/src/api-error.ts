/**
 * The bridge's error shape, in its own module so the JSON client
 * (`api.ts`) and the upload transport (`upload-api.ts`) can share it without
 * importing each other.
 */

/**
An HTTP failure from the bridge, carrying the engine's error payload.
*/
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
Turns a bridge error payload (or a proxy/platform failure) into an `ApiError`.
*/
export function apiError(status: number, payload: unknown): ApiError {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return new ApiError(
    typeof record.error === 'string' ? record.error : `Request failed (${status})`,
    status,
    typeof record.code === 'string' ? record.code : undefined,
  );
}
