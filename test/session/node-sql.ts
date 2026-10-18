import { DatabaseSync } from 'node:sqlite';
import type { SqlCursorLike, SqlStorageLike, TransactionalStorageLike } from '../../worker/src/session/mtproto/sqlite';

type SqlBinding = null | number | bigint | string | Uint8Array;

/**
 * `node:sqlite` fakes for the engine's storage adapter. The Durable Object's
 * `SqlStorage` is the real thing in production; these mirror its shape so the
 * adapter can be exercised under Vitest's node runtime.
 */

/**
A `SqlStorageLike` over `node:sqlite` (`exec` with and without bindings).
*/
export function createNodeSqlStorage(db: DatabaseSync): SqlStorageLike {
  return {
    exec(query: string, ...bindings: unknown[]): SqlCursorLike {
      let statement;
      try {
        statement = db.prepare(query);
      } catch (error) {
        // Multi-statement scripts only go through `db.exec`; mtcute's migrations
        // use single statements, so this is just a fallback for DDL batches.
        if (bindings.length > 0) throw error;
        db.exec(query);
        return { toArray: () => [] };
      }
      const rows = statement.all(...(bindings as SqlBinding[])) as Array<Record<string, unknown>>;
      return { toArray: () => rows };
    },
  };
}

/**
A `TransactionalStorageLike` over `node:sqlite`, with a real transaction.
*/
export function createNodeTransactionalStorage(db: DatabaseSync): TransactionalStorageLike {
  return {
    sql: createNodeSqlStorage(db),
    transactionSync<T>(closure: () => T): T {
      db.exec('begin');
      try {
        const result = closure();
        db.exec('commit');
        return result;
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
    },
  };
}

export function openNodeDatabase(): DatabaseSync {
  return new DatabaseSync(':memory:');
}
