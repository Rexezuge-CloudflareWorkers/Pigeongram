import type { SqlStorageLike } from '@pigeongram/provider-clients/mtproto/sqlite';

/**
The engine's avatar byte cache.

A profile photo is fetched straight from Telegram every time it is asked for:
`downloadAsIterable` streams `upload.getFile` and keeps nothing. The chat list
asks for one avatar per row, so a fresh visit queued dozens of Telegram round
trips through the Durable Object — and the object's input gate hands out one
event at a time, so every one of them sat in front of the thread the reader
was trying to open.

The bytes are small and the version token that identifies them is stable, so
they are worth keeping: a repeat visit reads them from the DO's own SQLite
instead of asking Telegram again.
*/

const CREATE_AVATARS = `create table if not exists engine_avatars (
  version text not null,
  size text not null,
  mime text not null,
  bytes blob not null,
  stored_at integer not null,
  primary key (version, size)
)`;

const SELECT_AVATAR = 'select mime, bytes from engine_avatars where version = ? and size = ?';

const INSERT_AVATAR = 'insert or replace into engine_avatars (version, size, mime, bytes, stored_at) values (?, ?, ?, ?, ?)';

const COUNT_AVATARS = 'select count(*) as total, coalesce(sum(length(bytes)), 0) as bytes from engine_avatars';

const EVICT_AVATARS =
  'delete from engine_avatars where (version, size) in (select version, size from engine_avatars order by stored_at limit ?)';

/**
How many avatars the cache keeps. A hundred chats with a photo each is two
hundred entries (a small and a big one), so the cap leaves room for a few
accounts' worth of churn.
*/
const MAX_ENTRIES = 512;

/**
How many bytes the cache keeps. Profile photos are a few kilobytes; a few
megabytes is a generous ceiling for the SQLite file the DO already carries.
*/
const MAX_BYTES = 8 * 1024 * 1024;

export interface CachedAvatar {
  mime: string;
  bytes: Uint8Array;
}

/**
The cached avatars, keyed by the version token Telegram gives a photo.
*/
export class AvatarCache {
  constructor(private readonly storage: SqlStorageLike) {
    this.storage.exec(CREATE_AVATARS);
  }

  /**
   * The cached bytes for a photo version, or null when they are not cached.
   *
   * The key is the version token the *engine* resolved, never one the caller
   * sent: a caller must not be able to name another peer's cached bytes.
   */
  read(version: string, size: string): CachedAvatar | null {
    const row = this.storage.exec(SELECT_AVATAR, version, size).toArray()[0];
    if (!row) return null;
    const stored = row.bytes;
    // The Durable Object's SQLite hands a blob back as an `ArrayBuffer`;
    // `node:sqlite` (the test harness) hands back a view.
    if (stored instanceof ArrayBuffer) {
      return { mime: String(row.mime), bytes: new Uint8Array(stored) };
    }
    if (ArrayBuffer.isView(stored)) {
      return { mime: String(row.mime), bytes: new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength) };
    }
    return null;
  }

  /**
   * Stores a photo's bytes and evicts the oldest entries when the cache is
   * over its bounds.
   */
  write(version: string, size: string, mime: string, bytes: Uint8Array): void {
    this.storage.exec(INSERT_AVATAR, version, size, mime, bytes, Date.now());
    const totals = this.storage.exec(COUNT_AVATARS).toArray()[0];
    const entries = Number(totals?.total ?? 0);
    const bytes_ = Number(totals?.bytes ?? 0);
    if (entries <= MAX_ENTRIES && bytes_ <= MAX_BYTES) return;
    // Evict in batches of a tenth of the cap, so a burst of new avatars does
    // not evict one row per write.
    const overflow = Math.max(entries - MAX_ENTRIES, Math.ceil((bytes_ - MAX_BYTES) / 4096));
    this.storage.exec(EVICT_AVATARS, Math.max(1, Math.ceil(overflow / 10)));
  }
}
