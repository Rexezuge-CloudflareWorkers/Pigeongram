import { describe, expect, it, vi } from 'vitest';
import type { TelegramDriver } from '../../packages/backend-services/src/session/driver';
import { createEngineContainer, Tokens } from '../../packages/backend-services/src/session/container';
import { createNodeTransactionalStorage, openNodeDatabase } from './node-sql';

/**
The Durable Object's composition root.

A container that created a fresh collaborator on every `get` would quietly
break the engine: two stores would write to the same tables through different
caches, and a second driver would own a second Telegram client. These checks
pin the singleton shape and the test override seam.
*/
function makeContainer(overrides: { driver?: TelegramDriver } = {}): ReturnType<typeof createEngineContainer> {
  const transaction = createNodeTransactionalStorage(openNodeDatabase());
  const state = {
    storage: {
      sql: transaction.sql,
      transactionSync: transaction.transactionSync,
      getAlarm: async () => null,
      setAlarm: async () => {},
      getWebSockets: () => [],
      waitUntil: () => {},
    },
  } as unknown as DurableObjectState;
  return createEngineContainer(state, {} as CloudflareEnv, overrides, () => 1_000_000, {
    onLoginSettled: () => {},
    onLoginFailed: () => {},
    stateSnapshot: async () => ({ phase: 'unauthorized', authorized: false, me: null }),
  });
}

describe('engine composition root', () => {
  it('memoizes collaborators as singletons', () => {
    const container = makeContainer();
    expect(container.get(Tokens.store)).toBe(container.get(Tokens.store));
    expect(container.get(Tokens.lifecycle)).toBe(container.get(Tokens.lifecycle));
    expect(container.has(Tokens.lifecycle)).toBe(true);
  });

  it('honours a replaced driver and the shared clock', () => {
    const driver = { rpc: vi.fn() } as unknown as TelegramDriver;
    const container = makeContainer({ driver });
    expect(container.get(Tokens.driver)).toBe(driver);
    expect(container.get(Tokens.now)()).toBe(1_000_000);
    expect(container.get(Tokens.config).wakeIntervalMs).toBe(300_000);
  });

  it('resolves the hub and login flow without a construction cycle', () => {
    const container = makeContainer();
    expect(container.get(Tokens.hub)).toBe(container.get(Tokens.hub));
    expect(container.get(Tokens.login)).toBe(container.get(Tokens.login));
    expect(container.get(Tokens.loginApi)).toBe(container.get(Tokens.loginApi));
  });
});
