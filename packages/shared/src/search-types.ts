/**
 * The search half of the bridge contract: a chat's own messages and the
 * account-wide search. Split from `rpc-types.ts` so the method shapes stay
 * under the god-file cap; the SPA mirrors this file in `apps/web/src/types.ts`.
 */

import type { ChatDto, MessageDto, PeerId } from './types';

export interface SearchMessagesParams {
  chatId: PeerId;
  query: string;
  limit?: number;
  /**
   * Pagination cursor: return messages older than this message id, as answered
   * by the previous page's `nextOffsetId`.
   */
  offsetId?: number;
}

export interface SearchMessagesResult {
  /**
   * The page, newest first — Telegram's own order for a search.
   */
  messages: MessageDto[];
  /**
   * The cursor for the next, older page; absent when the last page is loaded.
   */
  nextOffsetId?: number;
}

/**
 * Where the next global-search page starts.
 *
 * Telegram paginates `messages.searchGlobal` by a rate, the peer of the last
 * message and that message's id. The peer is sent as a marked id and resolved
 * server-side, so no access hash crosses the bridge.
 */
export interface SearchGlobalCursor {
  rate: number;
  chatId: PeerId;
  messageId: number;
}

export interface SearchGlobalParams {
  query: string;
  limit?: number;
  /**
   * The previous page's `next` cursor. Omitted for the first page.
   */
  offset?: SearchGlobalCursor;
}

export interface SearchGlobalResult {
  /**
   * The page, newest first — Telegram's own order for a global search.
   */
  messages: MessageDto[];
  /**
   * The distinct chats the page's messages belong to, so a result can be
   * rendered and opened even when its chat is not in the loaded chat list.
   */
  chats: ChatDto[];
  /**
   * The cursor for the next, older page; absent when the last page is loaded.
   */
  next?: SearchGlobalCursor;
}
