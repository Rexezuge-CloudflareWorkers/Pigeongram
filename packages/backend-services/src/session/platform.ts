/**
The Durable Object platform seam.

`DurableObjectState` exposes `blockConcurrencyWhile` and `waitUntil` in
workerd, but the plain class this engine extends under Vitest does not. The
three call sites used to each carry their own `as unknown as` cast; keeping
the structural check here means one place knows which parts of the state are
optional in a test and one place to change if the platform adds them to its
public type.
*/

type StateHost = {
  blockConcurrencyWhile?: <T>(callback: () => Promise<T>) => Promise<T>;
  waitUntil?: (work: Promise<unknown>) => void;
};

function hostOf(state: DurableObjectState): StateHost {
  return state;
}

/**
Runs `prepare` while the object has no other concurrent input, when the
platform supports it. The storage also prepares lazily, so a missing hook is
an optimization lost, not a broken object.
*/
export function prepareExclusively(state: DurableObjectState, prepare: () => Promise<void>): void {
  const host = hostOf(state);
  if (typeof host.blockConcurrencyWhile !== 'function') return;
  void host.blockConcurrencyWhile(prepare);
}

/**
Keeps `work` alive after the event that started it, when the platform
supports it. The work's own promise is still awaited by its caller; this only
prevents an early eviction.
*/
export function keepAlive(state: DurableObjectState, work: Promise<unknown>): void {
  const host = hostOf(state);
  if (typeof host.waitUntil !== 'function') return;
  host.waitUntil(work);
}
