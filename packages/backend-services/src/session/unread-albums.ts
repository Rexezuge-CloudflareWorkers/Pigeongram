import type { Dialog } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { UpdateEvent } from '../types';
import type { SqlStorageLike } from '@pigeongram/provider-clients/mtproto/sqlite';
import { log } from './log';

/**
 * The album ledger: which of a chat's unread messages are album members.
 *
 * Telegram counts every album member as a message, so an album of ten files
 * arrives as an unread count of ten. The badge counts an album once, so the
 * engine keeps the album members it has seen and subtracts the surplus: the
 * unread members of an album beyond the first of that album.
 *
 * The ledger learns from the update stream — every incoming album member is
 * recorded, a read drops the members it covered — so it costs no Telegram
 * traffic. It lives in the DO's SQLite because the engine sleeps between its
 * wakes: the album members outlive the connection that delivered them.
 */

const CREATE_MEMBERS = `create table if not exists engine_unread_albums (
  chat_id integer not null,
  message_id integer not null,
  grouped_id text not null,
  primary key (chat_id, message_id)
)`;

const CREATE_STATE = `create table if not exists engine_unread_state (
  key text primary key,
  value text not null
)`;

/**
 * The key under which the ledger remembers that it has been reconciled with
 * the account's unread albums.
 */
const RECONCILED_KEY = 'albums_reconciled';

/**
 * How many messages one reconciliation read per chat. Telegram's own limit is
 * a hundred; an unread range longer than that is only partly covered, which
 * leaves the badge a little too high for that chat until it is read.
 */
const RECONCILE_LIMIT = 100;

export class UnreadAlbumLedger {
  /**
   * Whether a rejected ledger write has already been reported. The ledger is an
   * accounting aid, not session state: once the Free plan's row budget is gone,
   * its writes are skipped so the update stream and the chat list keep working.
   */
  private warned = false;

  constructor(private readonly storage: SqlStorageLike) {
    // The DDL is best-effort too: the engine is constructed on every wake, and
    // a spent write budget must not take the whole object down with it.
    this.write(CREATE_MEMBERS);
    this.write(CREATE_STATE);
  }

  /**
   * Applies one ledger write, reporting the first rejection and ignoring the rest.
   */
  private write(query: string, ...bindings: unknown[]): void {
    try {
      this.storage.exec(query, ...bindings);
    } catch (error) {
      if (this.warned) return;
      this.warned = true;
      log.warn('albums.ledger_write_failed', { error });
    }
  }

  /**
   * Records an album member the account has not read yet.
   */
  recordIncoming(chatId: number, messageId: number, groupedId: string): void {
    this.write(
      'insert or ignore into engine_unread_albums (chat_id, message_id, grouped_id) values (?, ?, ?)',
      chatId,
      messageId,
      groupedId,
    );
  }

  /**
   * Drops the album members a read covered: the watermark is the last message
   * the account has read, so everything up to it is no longer unread.
   */
  pruneRead(chatId: number, maxId: number): void {
    this.write('delete from engine_unread_albums where chat_id = ? and message_id <= ?', chatId, maxId);
  }

  /**
   * How many of a chat's unread messages are album members beyond the first of
   * their album — the surplus an album-aware count subtracts.
   */
  excessFor(chatId: number): number {
    const row = this.storage
      .exec('select count(*) - count(distinct grouped_id) as excess from engine_unread_albums where chat_id = ?', chatId)
      .toArray()[0];
    return row ? Number(row.excess) : 0;
  }

  /**
   * The same surplus for every chat, in one query.
   */
  excessByChat(): Map<number, number> {
    const rows = this.storage
      .exec('select chat_id, count(*) - count(distinct grouped_id) as excess from engine_unread_albums group by chat_id')
      .toArray();
    const excess = new Map<number, number>();
    for (const row of rows) {
      excess.set(Number(row.chat_id), Number(row.excess));
    }
    return excess;
  }

  /**
   * Whether the ledger has been reconciled with the account's unread albums
   * since the last sign-in.
   */
  isReconciled(): boolean {
    const row = this.storage.exec('select value from engine_unread_state where key = ?', RECONCILED_KEY).toArray()[0];
    return row !== undefined;
  }

  /**
   * Marks the ledger as reconciled.
   */
  markReconciled(): void {
    this.write('insert or replace into engine_unread_state (key, value) values (?, ?)', RECONCILED_KEY, '1');
  }

  /**
   * Empties the ledger: the account it described is gone.
   */
  clear(): void {
    this.write('delete from engine_unread_albums');
    this.write('delete from engine_unread_state where key = ?', RECONCILED_KEY);
  }

  /**
   * Folds an update into the ledger and answers the event the bridge sends.
   *
   * A new message records its album membership; a read prunes the members it
   * covered and corrects the remaining count Telegram reported. Telegram
   * orders its updates by pts, so a message update always arrives before the
   * read that covers it — which is what makes the prune reliable.
   */
  apply(event: UpdateEvent): UpdateEvent {
    if (event.type === 'new_message') {
      const message = event.message;
      if (!message.outgoing && !message.service && message.groupedId !== null) {
        this.recordIncoming(message.chatId, message.id, message.groupedId);
      }
      return event;
    }
    if (event.type === 'read' && event.inbox) {
      this.pruneRead(event.chatId, event.maxId);
      return { ...event, unread: albumAwareUnread(event.unread, this.excessFor(event.chatId)) };
    }
    return event;
  }
}

/**
 * The count the badge shows: Telegram's count without the album surplus.
 */
export function albumAwareUnread(raw: number, excess: number): number {
  return Math.max(0, raw - excess);
}

/**
 * Reconciles the ledger with the albums the account already carries.
 *
 * The ledger learns the albums from the update stream, so it starts empty on a
 * fresh sign-in while the account may have unread albums from before. Reading
 * the unread range of every chat with unread messages fills it in — once per
 * sign-in, because the update stream keeps the ledger current from then on.
 */
export async function reconcileUnreadAlbums(client: TelegramClient, dialogs: readonly Dialog[], ledger: UnreadAlbumLedger): Promise<void> {
  if (ledger.isReconciled()) return;
  const unread = dialogs.filter((dialog) => dialog.unreadCount > 0);
  await Promise.all(unread.map((dialog) => reconcileChat(client, dialog, ledger)));
  ledger.markReconciled();
}

/**
 * Reads one chat's unread range and records the album members in it.
 *
 * A read that fails must not cost the chat list: the chats it did not reach
 * keep Telegram's raw count, and the next sign-in reconciles them again.
 */
async function reconcileChat(client: TelegramClient, dialog: Dialog, ledger: UnreadAlbumLedger): Promise<void> {
  const chatId = dialog.peer.id;
  const watermark = dialog.lastReadIngoing;
  const top = dialog.lastMessage?.id ?? 0;
  if (top <= watermark) return;
  try {
    const messages = await client.getHistory(chatId, { minId: watermark, maxId: top + 1, limit: RECONCILE_LIMIT });
    for (const message of messages) {
      const groupedId = message.groupedId?.toString();
      if (groupedId === undefined || message.isOutgoing || message.isService) continue;
      ledger.recordIncoming(chatId, message.id, groupedId);
    }
  } catch (error) {
    log.warn('albums.reconcile_failed', { error });
  }
}
