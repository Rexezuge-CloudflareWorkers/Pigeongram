import type { TelegramClient } from '@mtcute/core/client.js';
import { CallRegistry } from '../../worker/src/session/call-registry';
import { dispatchRpc } from '../../worker/src/session/rpc';
import { UnreadAlbumLedger } from '../../worker/src/session/unread-albums';
import { createNodeSqlStorage, openNodeDatabase } from './node-sql';

/**
 * The bridge's dispatch with an album ledger attached.
 *
 * The ledger is what makes the chat list count an album once instead of once
 * per file, so every dispatch in the suite carries one.
 */
export function albumLedger(): UnreadAlbumLedger {
  return new UnreadAlbumLedger(createNodeSqlStorage(openNodeDatabase()));
}

const albums = albumLedger();

/**
 * The calls the engine knows about. The registry holds the access hash of
 * every call it has seen, so a bridge method can address a call by its id.
 */
const calls = new CallRegistry();

export function rpc(client: TelegramClient, method: string, params: unknown): Promise<unknown> {
  return dispatchRpc(client, method, params, albums, calls);
}
