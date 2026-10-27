import { useCallback, useEffect, useRef, useState } from 'react';
import { searchGlobal, searchMessages } from './api';
import type { SearchNext, SearchScope } from './search';
import type { ChatDto, MessageDto, SearchGlobalResult, SearchMessagesResult } from './types';

/**
 * The search screen's controller: a debounced read, the pages after it, and
 * the two rules that keep a fast typist from seeing a stale answer — one
 * ticket per search, and a merge that never repeats a message.
 */

/**
 * How long typing settles before a read is sent. One search is one Durable
 * Object event, so a keystroke must not become a request.
 */
const DEBOUNCE_MS = 300;

/**
 * How many results one page asks for; the engine caps a search page at 100.
 */
const PAGE_LIMIT = 50;

export interface SearchController {
  query: string;
  setQuery: (query: string) => void;
  scope: SearchScope;
  setScope: (scope: SearchScope) => void;
  /**
   * The loaded pages, newest first, de-duplicated by chat and message id.
   */
  messages: readonly MessageDto[];
  /**
   * The chats the global pages named. A chat-only search answers none, because
   * the caller already knows the chat it searched.
   */
  chats: readonly ChatDto[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /**
   * Whether another page may exist.
   */
  hasMore: boolean;
  loadMore: () => void;
}

export interface UseSearchOptions {
  /**
   * Whether the overlay is open. A closed overlay stops searching.
   */
  active: boolean;
  initialScope: SearchScope;
  initialQuery?: string;
}

interface SearchAnswer {
  /**
   * The query and scope the answer belongs to. A late answer for an older
   * search stays in state but is never shown, so the screen cannot describe a
   * query the reader has already replaced.
   */
  key: string;
  messages: MessageDto[];
  chats: ChatDto[];
  next: SearchNext | null;
  error: string | null;
}

export function useSearch({ active, initialScope, initialQuery = '' }: UseSearchOptions): SearchController {
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScopeState] = useState(initialScope);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  // The key of the page being appended, if one is on its way. A plain boolean
  // would stay true when the reader changes the query mid-read.
  const [moreKey, setMoreKey] = useState<string | null>(null);
  // Every search takes a ticket; a slower answer that loses to a later query
  // must not put its page on screen.
  const sequence = useRef(0);

  const setScope = useCallback((nextScope: SearchScope): void => {
    setScopeState((current) => (sameScope(current, nextScope) ? current : nextScope));
  }, []);

  const needle = query.trim();
  const key = searchKey(scope, needle);
  // The first page is the answer for exactly this search; anything else is a
  // search still in flight (or one that has not been typed yet).
  const current = answer !== null && answer.key === key ? answer : null;
  const loading = active && needle.length > 0 && current === null;
  const loadingMore = moreKey !== null && moreKey === key;

  useEffect(() => {
    if (!active) return;
    const searched = query.trim();
    if (searched.length === 0) return;
    const searchedKey = searchKey(scope, searched);
    const ticket = ++sequence.current;
    const timer = setTimeout(() => {
      void loadPage(searched, scope, null)
        .then((page) => {
          if (ticket !== sequence.current) return;
          setAnswer({ key: searchedKey, messages: page.messages, chats: page.chats, next: page.next, error: null });
        })
        .catch((failure: unknown) => {
          if (ticket !== sequence.current) return;
          setAnswer({ key: searchedKey, messages: [], chats: [], next: null, error: failureText(failure) });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, query, scope]);

  const loadMore = useCallback((): void => {
    if (current === null || current.next === null || moreKey !== null) return;
    const searched = query.trim();
    if (searched.length === 0) return;
    const ticket = sequence.current;
    const searchedKey = current.key;
    const nextPage = current.next;
    setMoreKey(searchedKey);
    void loadPage(searched, scope, nextPage)
      .then((page) => {
        if (ticket !== sequence.current) return;
        setAnswer((previous) =>
          previous !== null && previous.key === searchedKey
            ? {
                key: searchedKey,
                messages: mergeMessages(previous.messages, page.messages),
                chats: mergeChats(previous.chats, page.chats),
                next: page.next,
                error: null,
              }
            : previous,
        );
      })
      .catch((failure: unknown) => {
        if (ticket !== sequence.current) return;
        setAnswer((previous) =>
          previous !== null && previous.key === searchedKey ? { ...previous, error: failureText(failure) } : previous,
        );
      })
      .finally(() => setMoreKey(null));
  }, [current, moreKey, query, scope]);

  return {
    query,
    setQuery,
    scope,
    setScope,
    messages: current?.messages ?? [],
    chats: current?.chats ?? [],
    loading,
    loadingMore,
    error: current?.error ?? null,
    hasMore: current !== null && current.next !== null,
    loadMore,
  };
}

interface SearchPage {
  messages: MessageDto[];
  chats: ChatDto[];
  next: SearchNext | null;
}

async function loadPage(query: string, scope: SearchScope, next: SearchNext | null): Promise<SearchPage> {
  if (scope.kind === 'chat') {
    const offsetId = next?.kind === 'chat' ? next.offsetId : undefined;
    const result: SearchMessagesResult = await searchMessages(scope.chatId, query, {
      limit: PAGE_LIMIT,
      ...(offsetId !== undefined && { offsetId }),
    });
    return {
      messages: result.messages,
      chats: [],
      next: result.nextOffsetId === undefined ? null : { kind: 'chat', offsetId: result.nextOffsetId },
    };
  }
  const offset = next?.kind === 'global' ? next.offset : undefined;
  const result: SearchGlobalResult = await searchGlobal(query, {
    limit: PAGE_LIMIT,
    ...(offset !== undefined && { offset }),
  });
  return {
    messages: result.messages,
    chats: result.chats,
    next: result.next === undefined ? null : { kind: 'global', offset: result.next },
  };
}

function sameScope(left: SearchScope, right: SearchScope): boolean {
  if (left.kind === 'all' || right.kind === 'all') return left.kind === right.kind;
  return left.chatId === right.chatId;
}

/**
 * The identity of one search: its scope and its trimmed query. The answer in
 * state is only shown while its key still matches the one on screen.
 */
function searchKey(scope: SearchScope, needle: string): string {
  return `${scope.kind === 'chat' ? String(scope.chatId) : 'all'}\u0000${needle}`;
}

function messageKey(message: MessageDto): string {
  return `${String(message.chatId)}:${String(message.id)}`;
}

/**
 * Appends a page without repeating a message. Telegram's global cursor is
 * exclusive, but an album or an edited page can still overlap, and a repeated
 * React key is worse than a redundant read.
 */
function mergeMessages(current: readonly MessageDto[], incoming: readonly MessageDto[]): MessageDto[] {
  const seen = new Set(current.map(messageKey));
  const merged = [...current];
  for (const message of incoming) {
    const key = messageKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  return merged;
}

function mergeChats(current: readonly ChatDto[], incoming: readonly ChatDto[]): ChatDto[] {
  const seen = new Set(current.map((chat) => chat.id));
  const merged = [...current];
  for (const chat of incoming) {
    if (seen.has(chat.id)) continue;
    seen.add(chat.id);
    merged.push(chat);
  }
  return merged;
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
