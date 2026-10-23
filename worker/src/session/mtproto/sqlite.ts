import {
  BaseSqliteStorage,
  BaseSqliteStorageDriver,
  MemoryPeersRepository,
  MemoryRefMessagesRepository,
  MemoryStorageDriver,
} from '@mtcute/core';
import type { ISqliteDatabase, ISqliteStatement, ITelegramStorageProvider } from '@mtcute/core';

/**
The slice of `SqlStorage` this adapter reads — structural, so tests can fake it.
*/
export interface SqlCursorLike {
  toArray(): Array<Record<string, unknown>>;
}

export interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
  /**
  Size of the underlying database in bytes; the DO exposes this.
  */
  readonly databaseSize?: number;
}

/**
A SQL storage that can also run closures in a transaction (the DO's storage).
*/
export interface TransactionalStorageLike {
  readonly sql: SqlStorageLike;
  transactionSync<T>(closure: () => T): T;
}

/**
 * `better-sqlite3`-shaped adapter over the Durable Object's SQLite, the shape
 * `BaseSqliteStorageDriver` expects (`ISqliteDatabase`).
 *
 * Notes on the translation:
 * - DO SQL has no prepared-statement objects; each call re-executes the SQL.
 *   The strings come from mtcute's repositories and are constant, so there is
 *   no injection surface added here.
 * - Blobs come back as `ArrayBuffer`; mtcute's TL layer wants `Uint8Array`.
 * - `transaction` maps onto `storage.transactionSync`, the DO's supported way
 *   of atomically applying a batch of statements.
 */
export class DoSqliteDatabase {
  constructor(private readonly storage: TransactionalStorageLike) {}

  exec(sql: string): void {
    this.storage.sql.exec(sql);
  }

  prepare<BindParameters extends unknown[]>(sql: string): ISqliteStatement<BindParameters> {
    return {
      run: (...params: BindParameters): void => {
        this.storage.sql.exec(sql, ...params);
      },
      get: (...params: BindParameters): unknown => normalizeRow(this.select(sql, params)[0]),
      all: (...params: BindParameters): unknown[] => this.select(sql, params).map(normalizeRow),
    };
  }

  private select(sql: string, params: unknown[]): Array<Record<string, unknown>> {
    return this.storage.sql.exec(sql, ...params).toArray();
  }

  transaction<F extends (...args: never[]) => unknown>(fn: F): F {
    const wrapped = (...args: unknown[]): unknown => this.storage.transactionSync(() => fn(...(args as never[])));
    return wrapped as unknown as F;
  }

  close(): void {
    // The DO owns the database's lifetime; there is nothing to close here.
  }
}

/**
 * `close()` is a no-op, so a fresh database per `_load()` is safe.
 */
export function createDoSqliteDatabase(storage: TransactionalStorageLike): ISqliteDatabase {
  return new DoSqliteDatabase(storage);
}

export class DoSqliteStorageDriver extends BaseSqliteStorageDriver {
  constructor(private readonly storage: TransactionalStorageLike) {
    super();
  }

  // eslint-disable-next-line unicorn/prefer-private-class-fields -- overrides mtcute's `_createDatabase` hook
  _createDatabase(): ISqliteDatabase {
    return createDoSqliteDatabase(this.storage);
  }
}

/**
The provider `createTelegramStorage` builds. `driver` is narrowed to the
concrete adapter so the lifecycle mtcute calls (`setup`, `load`, `save`) is
visible without the optional-call shape of `IStorageDriver`.
*/
export interface TelegramStorageProvider extends ITelegramStorageProvider {
  readonly driver: DoSqliteStorageDriver;
}

/**
mtcute's storage wired to the DO's SQLite.

Only the durable state mtcute needs to resume a session is SQLite: the auth
keys, the update cursor, and the DC/salt caches in `key_value`. The peer and
reference-message caches are **memory-only**, because mtcute refills them on
every response (`peers.updatePeersFrom`) and a cold DO — which every wake is —
would rewrite every peer on each read. On the Free plan that write traffic is
the scarce resource (100,000 rows/day, and an indexed row costs more than one);
a lost cache entry only costs a Telegram read, which is cheap.
*/
export function createTelegramStorage(storage: TransactionalStorageLike): TelegramStorageProvider {
  const driver = new DoSqliteStorageDriver(storage);
  const durable = new BaseSqliteStorage(driver);
  const memory = new MemoryStorageDriver();
  return {
    driver,
    kv: durable.kv,
    authKeys: durable.authKeys,
    peers: new MemoryPeersRepository(memory),
    refMessages: new MemoryRefMessagesRepository(memory),
  };
}

function normalizeRow(row: Record<string, unknown> | undefined): unknown {
  if (!row) return undefined;
  let converted: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(row)) {
    if (!(value instanceof ArrayBuffer)) {
      continue;
    }

    converted ??= { ...row };
    converted[key] = new Uint8Array(value);
  }
  return converted ?? row;
}
