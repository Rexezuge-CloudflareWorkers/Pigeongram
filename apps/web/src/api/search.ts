import type { PeerId, SearchGlobalCursor, SearchGlobalResult, SearchMessagesResult } from '../types';
import { rpc } from './request';

/**
 * The search half of the bridge client: one chat's messages and the
 * account-wide search. Both pages answer newest first, and the caller pages
 * with the cursor the previous page returned.
 */

/**
 * How many results one page asks for. Telegram caps a search page at 100; 50
 * keeps the first page light enough for the overlay and the rest one tap away.
 */
const SEARCH_LIMIT = 50;

export const searchMessages = (
  chatId: PeerId,
  query: string,
  options: { limit?: number; offsetId?: number } = {},
): Promise<SearchMessagesResult> =>
  rpc('searchMessages', {
    chatId,
    query,
    limit: options.limit ?? SEARCH_LIMIT,
    ...(options.offsetId !== undefined && { offsetId: options.offsetId }),
  });

export const searchGlobal = (query: string, options: { limit?: number; offset?: SearchGlobalCursor } = {}): Promise<SearchGlobalResult> =>
  rpc('searchGlobal', {
    query,
    limit: options.limit ?? SEARCH_LIMIT,
    ...(options.offset !== undefined && { offset: options.offset }),
  });
