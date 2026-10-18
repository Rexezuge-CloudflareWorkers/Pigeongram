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
