/**
The contacts half of the bridge contract: the people the account knows, and
Telegram's own search over people and public chats. Split from `rpc-types.ts`
so the method shapes stay under the god-file cap; the SPA re-exports these
types from `apps/web/src/types.ts`.
*/

import type { ChatDto } from './types';

/**
Reads the account's contacts, or searches Telegram for people and chats.

An absent (or blank) query reads the address book: `people` is the account's
contacts, `chats` is empty. A query asks Telegram instead, and the answer is
the relevance-ordered people and public chats it matched.
*/
export interface SearchContactsParams {
  query?: string;
  limit?: number;
}

/**
The picker's answer: the people it found, then the public chats Telegram
matched. Both are ordinary chat DTOs, so opening one is the same path a
link-resolved chat takes.
*/
export interface SearchContactsResult {
  people: ChatDto[];
  chats: ChatDto[];
}
