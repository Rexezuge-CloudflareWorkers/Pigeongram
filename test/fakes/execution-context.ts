// Stub for ExecutionContext (waitUntil / passThroughOnException).

export interface FakeExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  pending: Promise<unknown>[];
}

export function createExecutionContextStub(): FakeExecutionContext {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {
      // no-op
    },
  };
}
