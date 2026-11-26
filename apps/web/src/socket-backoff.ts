/**
Reconnect timing for the updates socket, as a pure function.

The cap keeps an outage from growing the delay without bound; the exponential
step backs off quickly; the ±20% jitter stops every tab reconnecting in
lockstep after a deployment. `jitter` is injected so the schedule is testable
without fake timers or a mocked socket.
*/
export function reconnectDelay(retry: number, jitter: number): number {
  const base = Math.min(15_000, 500 * 2 ** Math.min(Math.max(retry, 0), 5));
  return Math.round(base * (0.8 + jitter * 0.4));
}
