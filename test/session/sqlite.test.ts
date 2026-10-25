import { LogManager } from '@mtcute/core/utils.js';
import { describe, expect, it } from 'vitest';
import { createDoSqliteDatabase, createTelegramStorage } from '../../packages/provider-clients/src/mtproto/sqlite';
import type { TransactionalStorageLike } from '../../packages/provider-clients/src/mtproto/sqlite';
import { WorkerPlatform } from '../../packages/provider-clients/src/mtproto/platform';
import { createNodeTransactionalStorage, openNodeDatabase } from './node-sql';

describe('DoSqliteDatabase', () => {
  it('runs statements and returns rows with bindings', () => {
    const db = createNodeTransactionalStorage(openNodeDatabase());
    const adapter = createDoSqliteDatabase(db);

    adapter.exec('create table t (id integer primary key, name text)');
    adapter.prepare<[number, string]>('insert into t (id, name) values (?, ?)').run(1, 'one');
    adapter.prepare<[string]>('insert into t (name) values (?)').run('two');

    const all = adapter.prepare('select id, name from t order by id').all() as Array<{
      id: number;
      name: string;
    }>;
    expect(all).toEqual([
      { id: 1, name: 'one' },
      { id: 2, name: 'two' },
    ]);
    const one = adapter.prepare<[number]>('select name from t where id = ?').get(1) as {
      name: string;
    };
    expect(one.name).toBe('one');
    expect(adapter.prepare<[number]>('select name from t where id = ?').get(99)).toBeUndefined();
  });

  it('converts ArrayBuffer blobs into Uint8Array', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const storage: TransactionalStorageLike = {
      sql: {
        exec: () => ({ toArray: () => [{ payload: buffer, name: 'row' }] }),
      },
      transactionSync: (closure) => closure(),
    };
    const row = createDoSqliteDatabase(storage).prepare('select payload, name from t').get() as {
      payload: unknown;
      name: string;
    };
    expect(row.name).toBe('row');
    expect(row.payload).toBeInstanceOf(Uint8Array);
    expect([...(row.payload as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it('wraps statements in the storage transaction', () => {
    const db = createNodeTransactionalStorage(openNodeDatabase());
    const adapter = createDoSqliteDatabase(db);
    adapter.exec('create table t (id integer primary key)');
    const insert = adapter.prepare<[number]>('insert into t (id) values (?)');
    const runTwo = adapter.transaction((a: number, b: number) => {
      insert.run(a);
      insert.run(b);
    });

    runTwo(1, 2);
    expect(adapter.prepare('select count(*) as n from t').get()).toEqual({ n: 2 });

    // A thrown error rolls the whole batch back.
    expect(() =>
      adapter.transaction((values: number[]) => {
        for (const value of values) insert.run(value);
        throw new Error('boom');
      })([3, 4]),
    ).toThrow('boom');
    expect(adapter.prepare('select count(*) as n from t').get()).toEqual({ n: 2 });
  });
});

describe('telegram storage over the DO adapter', () => {
  it('runs mtcute migrations and round-trips through save()', async () => {
    const db = openNodeDatabase();
    const storage = createTelegramStorage(createNodeTransactionalStorage(db));
    const platform = new WorkerPlatform();
    storage.driver.setup(new LogManager('test', platform), platform);
    await storage.driver.load();

    // kv writes are write-behind: invisible until save(), then durable.
    await storage.kv.set('key', new Uint8Array([1, 2, 3]));
    expect(storage.kv.get('key')).toBeNull();
    await storage.driver.save();
    expect(storage.kv.get('key')).toEqual(new Uint8Array([1, 2, 3]));

    await storage.authKeys.set(2, new Uint8Array([9, 8, 7]));
    expect(storage.authKeys.get(2)).toEqual(new Uint8Array([9, 8, 7]));

    // A second instance over the same database sees the migrated schema and
    // the persisted rows (no "table already exists" from re-running migrations).
    const reopened = createTelegramStorage(createNodeTransactionalStorage(db));
    reopened.driver.setup(new LogManager('test', platform), platform);
    await reopened.driver.load();
    expect(reopened.kv.get('key')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps peer and reference-message caches off SQLite', async () => {
    const statements: string[] = [];
    const storage: TransactionalStorageLike = {
      sql: {
        exec: (query: string) => {
          statements.push(query);
          return { toArray: () => [] };
        },
      },
      transactionSync: (closure) => closure(),
    };
    const provider = createTelegramStorage(storage);

    await provider.peers.store({
      id: 42,
      accessHash: '1',
      isMin: false,
      usernames: ['someone'],
      updated: Date.now(),
      complete: new Uint8Array([1, 2, 3]),
    });
    await provider.refMessages.store(1, 2, 3);

    expect(provider.peers.getById(42)).toMatchObject({ id: 42 });
    expect(provider.refMessages.getByPeer(1)).toEqual([2, 3]);
    // The caches mtcute refills on every response never reach the DO's SQLite:
    // each indexed row would cost several writes of the Free plan's daily budget.
    expect(statements).toEqual([]);
  });
});
