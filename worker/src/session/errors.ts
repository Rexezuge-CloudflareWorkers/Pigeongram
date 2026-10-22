/**
An error the engine maps onto an HTTP status for the bridge.
*/
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'EngineError';
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
