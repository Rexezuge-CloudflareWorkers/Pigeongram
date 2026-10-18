import type { SqlStorageLike } from './mtproto/sqlite';

const RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

/**
The `GET /api/stats` payloads. Only the worker serves this route, so the
shapes live with their producer rather than in the shared bridge contract.
*/
export interface WakeCountersDto {
  totalWakes: number;
  failedWakes: number;
  avgWakeMs: number;
  updatesSeen: number;
  lastWakeAt: number | null;
}

export interface DayBucketDto {
  day: string;
  wakes: number;
  failures: number;
  avgMs: number;
  updates: number;
}

export interface StatsDto {
  counters: WakeCountersDto;
  days: DayBucketDto[];
  databaseBytes: number | null;
}

export interface WakeRecord {
  reason: string;
  durationMs: number;
  updates: number;
  ok: boolean;
  error?: string | null;
}

const CREATE_WAKES = `create table if not exists engine_wakes (
  id integer primary key autoincrement,
  ts integer not null,
  reason text not null,
  duration_ms integer not null,
  updates integer not null,
  ok integer not null,
  error text
)`;

const CREATE_META = `create table if not exists engine_meta (
  key text primary key,
  value text not null
)`;

/**
 * The engine's own bookkeeping on the DO's SQLite: the wake log feeding the
 * soak stats and a tiny key/value table for persisted bits (the signed-in
 * user's DTO, the last error). Table names are prefixed `engine_` to stay out
 * of mtcute's namespace.
 */
export class EngineStore {
  constructor(private readonly storage: SqlStorageLike) {
    this.storage.exec(CREATE_WAKES);
    this.storage.exec(CREATE_META);
  }

  readMeta(key: string): string | null {
    const row = this.storage.exec('select value from engine_meta where key = ?', key).toArray()[0];
    return row ? String(row.value) : null;
  }

  writeMeta(key: string, value: string | null): void {
    if (value === null) {
      this.storage.exec('delete from engine_meta where key = ?', key);
      return;
    }
    this.storage.exec('insert or replace into engine_meta (key, value) values (?, ?)', key, value);
  }

  recordWake(record: WakeRecord): void {
    const ts = Date.now();
    this.storage.exec(
      `insert into engine_wakes (ts, reason, duration_ms, updates, ok, error)
       values (?, ?, ?, ?, ?, ?)`,
      ts,
      record.reason,
      Math.round(record.durationMs),
      record.updates,
      record.ok ? 1 : 0,
      record.error ?? null,
    );
    this.storage.exec('delete from engine_wakes where ts < ?', ts - RETENTION_MS);
  }

  counters(): WakeCountersDto {
    const row = this.storage
      .exec(
        `select count(*) as total,
                coalesce(sum(case when ok = 0 then 1 else 0 end), 0) as failures,
                coalesce(avg(duration_ms), 0) as avg_ms,
                coalesce(sum(updates), 0) as updates,
                max(ts) as last_ts
         from engine_wakes`,
      )
      .toArray()[0];
    return {
      totalWakes: toNumber(row?.total),
      failedWakes: toNumber(row?.failures),
      avgWakeMs: Math.round(toNumber(row?.avg_ms)),
      updatesSeen: toNumber(row?.updates),
      lastWakeAt: row?.last_ts === null || row?.last_ts === undefined ? null : toNumber(row.last_ts),
    };
  }

  daily(days = 7): DayBucketDto[] {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this.storage
      .exec(
        `select strftime('%Y-%m-%d', ts / 1000, 'unixepoch') as day,
                count(*) as wakes,
                coalesce(sum(case when ok = 0 then 1 else 0 end), 0) as failures,
                coalesce(avg(duration_ms), 0) as avg_ms,
                coalesce(sum(updates), 0) as updates
         from engine_wakes
         where ts >= ?
         group by day
         order by day`,
        since,
      )
      .toArray();
    return rows.map((row) => ({
      day: String(row.day),
      wakes: toNumber(row.wakes),
      failures: toNumber(row.failures),
      avgMs: Math.round(toNumber(row.avg_ms)),
      updates: toNumber(row.updates),
    }));
  }

  stats(days = 7): StatsDto {
    return {
      counters: this.counters(),
      days: this.daily(days),
      databaseBytes: this.storage.databaseSize ?? null,
    };
  }
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}
