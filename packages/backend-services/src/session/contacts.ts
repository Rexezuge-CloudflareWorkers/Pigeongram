import { Chat, User } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { SearchContactsResult } from '../rpc-types';
import { toChatDto } from './dto';
import { EngineError } from './errors';
import { clampInt } from './params';

/**
The new-message half of the bridge: the account's contacts, and Telegram's
own search over people and public chats.

An empty query reads the address book in one call; a query asks
`contacts.search`, which is also the only read that finds a chat the account
has never seen. Either way every peer is resolved and described here — the
browser never carries an access hash — and the answer is ordinary chat DTOs,
so opening a result takes the same path a resolved link does.
*/

/**
The query is Telegram's own search box, so its cap is the bridge's, not
Telegram's: a pasted document must not become a request.
*/
const QUERY_MAX = 256;

/**
One page of search results. The picker is a shortlist, not a directory.
*/
const SEARCH_LIMIT_MAX = 50;
const SEARCH_LIMIT_DEFAULT = 20;

/**
Reads the contacts, or searches for the query.

A blank query is the address book: the picker shows it before the reader
types. Sorting is explicit rather than Telegram's order, so two reads of the
same address book cannot list the same people differently.
*/
export async function searchContacts(client: TelegramClient, params: Record<string, unknown>): Promise<SearchContactsResult> {
  const query = readQuery(params.query);
  if (query === undefined) {
    return { people: await readContacts(client), chats: [] };
  }
  const limit = clampInt(params.limit, 1, SEARCH_LIMIT_MAX, SEARCH_LIMIT_DEFAULT);
  const found = await client.call({ _: 'contacts.search', q: query, limit });
  return {
    people: peopleOf(found.users),
    // An incomplete (`min`) chat carries a reduced access hash that cannot
    // address it outside a message, so the picker does not offer one.
    chats: chatsOf(found.chats),
  };
}

/**
The account's contacts, in the picker's alphabetical order.

Telegram answers every contact in one call (hash zero asks for the whole
list). A deleted account has no thread to open and the account's own row is
the Saved Messages dialog, so neither belongs in a "new message" list.
*/
async function readContacts(client: TelegramClient): Promise<SearchContactsResult['people']> {
  const contacts = await client.getContacts();
  return peopleOf(contacts.map((contact) => contact.raw)).toSorted(byTitle);
}

/**
Maps raw users onto the chat DTO, dropping the ones that cannot be opened.
*/
function peopleOf(users: readonly tl.TypeUser[]): SearchContactsResult['people'] {
  return users
    .map((raw) => new User(raw))
    .filter((user) => !user.isDeleted && !user.isSelf)
    .map(toChatDto);
}

/**
Maps raw chats onto the chat DTO, keeping only the addressable ones.
*/
function chatsOf(chats: readonly tl.TypeChat[]): SearchContactsResult['chats'] {
  return chats
    .map((raw) => new Chat(raw))
    .filter((chat) => !chat.isMin)
    .map(toChatDto);
}

/**
Alphabetical by display name, case-insensitively, so the picker does not
separate "ada" from "Ada" into two blocks.
*/
function byTitle(left: { title: string }, right: { title: string }): number {
  return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
}

/**
The picker's query, or undefined when there is nothing to search for.

A blank string is the address book rather than an error: the search field's
own placeholder reads as an empty query while it is untouched.
*/
function readQuery(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new EngineError('query must be a string', 400);
  }
  const query = value.trim();
  if (query.length === 0) return undefined;
  if (query.length > QUERY_MAX) {
    throw new EngineError(`query must be at most ${QUERY_MAX} characters`, 400);
  }
  return query;
}
