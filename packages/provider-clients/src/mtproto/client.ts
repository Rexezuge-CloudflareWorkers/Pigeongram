import { BaseTelegramClient, TelegramClient } from '@mtcute/core/client.js';
import { WorkerCryptoProvider } from './crypto';
import { WorkerPlatform } from './platform';
import { createTelegramStorage } from './sqlite';
import type { TelegramStorageProvider, TransactionalStorageLike } from './sqlite';
import { WorkersWsTransport } from './transport';

/**
Raised when the worker is deployed without Telegram API credentials.
*/
export class EngineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineConfigError';
  }
}

/**
The mtcute client stack: the low-level client, the high-level facade, storage.
*/
export interface MtBundle {
  base: BaseTelegramClient;
  client: TelegramClient;
  storage: TelegramStorageProvider;
}

export function readApiCredentials(env: CloudflareEnv): { apiId: number; apiHash: string } {
  const apiIdRaw = (env.TELEGRAM_API_ID ?? '').trim();
  const apiHash = (env.TELEGRAM_API_HASH ?? '').trim();
  const apiId = Number(apiIdRaw);
  if (!apiIdRaw || !Number.isSafeInteger(apiId) || apiId <= 0) {
    throw new EngineConfigError('TELEGRAM_API_ID is not configured — set it with `wrangler secret put TELEGRAM_API_ID`.');
  }
  if (!apiHash) {
    throw new EngineConfigError('TELEGRAM_API_HASH is not configured — set it with `wrangler secret put TELEGRAM_API_HASH`.');
  }
  return { apiId, apiHash };
}

/**
 * Builds mtcute for the DO: SQLite storage on the DO's database, the WSS
 * transport to `apiws`, the workerd crypto provider, and the updates manager
 * (whose `catchUp` option is what the wake cycle replays `getDifference`
 * with).
 *
 * The high-level {@link TelegramClient} is created with `disableUpdates: true`
 * because the engine consumes **raw** updates (`base.onRawUpdate`) and maps
 * them to its own DTOs; the high-level parsing pipeline is skipped.
 */
export function createMtBundle(env: CloudflareEnv, storage: TransactionalStorageLike): MtBundle {
  const { apiId, apiHash } = readApiCredentials(env);
  const provider = createTelegramStorage(storage);
  const base = new BaseTelegramClient({
    apiId,
    apiHash,
    storage: provider,
    transport: new WorkersWsTransport(),
    crypto: new WorkerCryptoProvider(),
    platform: new WorkerPlatform(),
    updates: { catchUp: true },
  });
  const client = new TelegramClient({
    client: base,
    disableUpdates: true,
  });
  return { base, client, storage: provider };
}
