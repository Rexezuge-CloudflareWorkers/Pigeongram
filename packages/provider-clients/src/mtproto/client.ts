import { ServiceError } from '@rexezuge/errors';
import { EnvParser } from '@rexezuge/runtime/config/EnvParser';
import { BaseTelegramClient, TelegramClient } from '@mtcute/core/client.js';
import { WorkerCryptoProvider } from './crypto';
import { WorkerPlatform } from './platform';
import { createTelegramStorage } from './sqlite';
import type { TelegramStorageProvider, TransactionalStorageLike } from './sqlite';
import { WorkersWsTransport } from './transport';

/**
Raised when the worker is deployed without Telegram API credentials.

A `ServiceError` rather than a bare `Error`: the bridge boundary answers it as
`503 config` through the same mapper as every other typed failure, and a bare
error would arrive at the client as a masked 500 that hides the one message an
operator can act on.
*/
export class EngineConfigError extends ServiceError {
  constructor(message: string) {
    super(503, 'config', message, { expose: true });
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

/**
 * The two secret-backed values the mtcute client needs. Narrowed from
 * `CloudflareEnv` so a test can supply just the pair it is exercising.
 */
export interface ApiCredentialEnv {
  readonly TELEGRAM_API_ID?: string;
  readonly TELEGRAM_API_HASH?: string;
}

export function readApiCredentials(env: ApiCredentialEnv): { apiId: number; apiHash: string } {
  // `positiveInt` answers the fallback for every unusable value, so `0` is the
  // one sentinel that means "absent, malformed or out of range" at once.
  const apiId = EnvParser.positiveInt(env, 'TELEGRAM_API_ID', '0');
  if (apiId <= 0) {
    throw new EngineConfigError('TELEGRAM_API_ID is not configured — set it with `wrangler secret put TELEGRAM_API_ID`.');
  }
  const apiHash = EnvParser.readString(env, 'TELEGRAM_API_HASH')?.trim() ?? '';
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
