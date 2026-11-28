/**
The browser subscriptions the engine sends notifications to.

One row per device (`endpoint` is unique), stored in the Durable Object's
SQLite like the other engine tables. Writes are deliberate: the account's
100,000-rows/day budget is shared with the wake log, so a delivery never
writes a "last notified" marker and a refused push only writes when a
subscription is actually dead. Reads are cheap and happen once per batch.
*/

import type { SqlStorageLike } from '@pigeongram/provider-clients/mtproto/sqlite';
import type { PushSubscriptionDto } from '../types';
import { EngineError } from './errors';
import { log } from './log';

/**
A bound on devices, so a leaked endpoint cannot grow the table without limit.
*/
export const MAX_PUSH_SUBSCRIPTIONS = 12;

/**
After this many refused deliveries a subscription is treated as dead.
*/
export const MAX_PUSH_FAILURES = 3;

const CREATE_SUBSCRIPTIONS = `create table if not exists engine_push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at integer not null,
  last_used_at integer not null,
  failures integer not null default 0
)`;

export interface StoredPushSubscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly failures: number;
}

export class PushSubscriptions {
  constructor(
    private readonly storage: SqlStorageLike,
    private readonly now: () => number = Date.now,
  ) {
    this.storage.exec(CREATE_SUBSCRIPTIONS);
  }

  all(): StoredPushSubscription[] {
    return this.storage.exec('select * from engine_push_subscriptions order by created_at').toArray().map(toSubscription);
  }

  count(): number {
    return Number(this.storage.exec('select count(*) as total from engine_push_subscriptions').toArray()[0]?.total ?? 0);
  }

  /**
  Adds or refreshes a device. A full table is a conflict rather than a
  silent eviction: the browser is told to ask the reader to turn push off on
  another device first.
  */
  upsert(subscription: PushSubscriptionDto): void {
    if (this.count() >= MAX_PUSH_SUBSCRIPTIONS && !this.has(subscription.endpoint)) {
      throw new EngineError('The push subscription limit has been reached', 409, 'conflict');
    }
    const ts = this.now();
    this.storage.exec(
      `insert into engine_push_subscriptions (endpoint, p256dh, auth, created_at, last_used_at, failures)
       values (?, ?, ?, ?, ?, 0)
       on conflict(endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
         last_used_at = excluded.last_used_at, failures = 0`,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      ts,
      ts,
    );
  }

  has(endpoint: string): boolean {
    return this.storage.exec('select 1 from engine_push_subscriptions where endpoint = ?', endpoint).toArray().length > 0;
  }

  remove(endpoint: string): void {
    try {
      this.storage.exec('delete from engine_push_subscriptions where endpoint = ?', endpoint);
    } catch (error) {
      // Cleanup is best effort: a spent write budget must not turn a delivered
      // notification into a failed wake.
      log.warn('push.cleanup_failed', { error });
    }
  }

  clear(): void {
    try {
      this.storage.exec('delete from engine_push_subscriptions');
    } catch (error) {
      log.warn('push.cleanup_failed', { error });
    }
  }

  /**
  Records a refused delivery and returns the new failure count. The caller
  drops the subscription once it is past `MAX_PUSH_FAILURES`.
  */
  noteFailure(endpoint: string): number {
    try {
      this.storage.exec('update engine_push_subscriptions set failures = failures + 1 where endpoint = ?', endpoint);
    } catch (error) {
      log.warn('push.cleanup_failed', { error });
      return MAX_PUSH_FAILURES;
    }
    const row = this.storage.exec('select failures from engine_push_subscriptions where endpoint = ?', endpoint).toArray()[0];
    const failures = Number(row?.failures ?? MAX_PUSH_FAILURES);
    if (failures >= MAX_PUSH_FAILURES) this.remove(endpoint);
    return failures;
  }
}

function toSubscription(row: Record<string, unknown>): StoredPushSubscription {
  return {
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
    failures: Number(row.failures),
  };
}
