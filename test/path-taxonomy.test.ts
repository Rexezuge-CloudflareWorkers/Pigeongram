import { describe, expect, it, vi } from 'vitest';

// The wasm provider cannot instantiate under node; the route table never
// reaches the crypto primitives.
vi.mock('../packages/provider-clients/src/mtproto/crypto', () => ({
  WorkerCryptoProvider: class {
    initialize(): void {}
    randomFill(buffer: Uint8Array): void {
      crypto.getRandomValues(buffer as Uint8Array<ArrayBuffer>);
    }
  },
}));
import { ENGINE_PATHS, MEDIA_PATHS } from '../packages/backend-runtime/src/constants';
import { allRoutes } from '../apps/api/src/endpoints/routeTable';
import { SessionEngine } from '../packages/backend-services/src/session/engine';
import { createNodeTransactionalStorage, openNodeDatabase } from './session/node-sql';

/**
The edge and the Durable Object disagree at their peril: a path the edge
forwards but the engine does not know is a 404 for a real feature, and a
media path left out of the shared bucket spends the account's request budget.
These are the invariants the two halves of the bridge promise each other.
*/
describe('bridge path taxonomy', () => {
  it('keeps every media path in the engine surface', () => {
    for (const path of MEDIA_PATHS) expect(ENGINE_PATHS.has(path)).toBe(true);
  });

  it('keeps every concrete edge route in the engine surface', () => {
    const edgeOnly = new Set(['/user/login', '/api/health']);
    for (const route of allRoutes) {
      if (edgeOnly.has(route.path) || route.path.includes('*')) continue;
      expect(ENGINE_PATHS.has(route.path), `${route.path} is forwarded to the engine`).toBe(true);
    }
  });

  it('recognises every engine path as an account path', () => {
    for (const path of ENGINE_PATHS) expect(path.startsWith('/user/')).toBe(true);
  });

  it('gives every declared engine path at least one handler', () => {
    const transaction = createNodeTransactionalStorage(openNodeDatabase());
    const state = {
      storage: transaction,
      getWebSockets: () => [],
      blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
    } as unknown as DurableObjectState;
    const engine = new SessionEngine(state, {} as CloudflareEnv);
    const served = new Set(engine.routeKeys.map((key) => key.split(' ', 2)[1]));
    for (const path of ENGINE_PATHS) expect(served.has(path), `${path} has no handler`).toBe(true);
  });
});
