import { useCallback, useEffect, useRef, useState } from 'react';
import { searchContacts } from './api';
import type { ChatDto } from './types';

/**
 * The new-message picker's controller: the account's contacts before the
 * reader types, and Telegram's own search once they do.
 *
 * One picker open is one read of the address book, and one read per settled
 * query — one Durable Object event and one Telegram call each. The blank query
 * is deliberately kept apart from the searched one: clearing the field returns
 * to the contacts already in hand instead of paying for them again.
 */

/**
 * How long typing settles before a read is sent, matching the search screen:
 * one search is one Durable Object event, so a keystroke must not become a
 * request.
 */
const DEBOUNCE_MS = 300;

interface UseNewChatResult {
  query: string;
  setQuery: (query: string) => void;
  /**
   * The blank-query list: the account's contacts, alphabetically.
   */
  contacts: readonly ChatDto[];
  /**
   * The searched people, in Telegram's relevance order.
   */
  people: readonly ChatDto[];
  /**
   * The public chats the search matched.
   */
  chats: readonly ChatDto[];
  loading: boolean;
  error: string | null;
  /**
   * Reads the contacts again after a failure.
   */
  retry: () => void;
}

interface SearchAnswer {
  /**
   * The trimmed query the answer belongs to. A late answer for an older query
   * stays in state but is never shown, so the list cannot describe a query the
   * reader has already replaced.
   */
  key: string;
  people: ChatDto[];
  chats: ChatDto[];
  error: string | null;
}

interface ContactsAnswer {
  contacts: ChatDto[];
  error: string | null;
}

export function useNewChat(): UseNewChatResult {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ContactsAnswer | null>(null);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  // Every read takes a ticket; a slower answer that loses to a later query (or
  // a retry) must not put its page on screen. The address book and the search
  // have their own tickets: typing must not discard a contact list still on
  // its way, or clearing the field would leave the picker loading forever.
  const contactsSequence = useRef(0);
  const searchSequence = useRef(0);
  // Each read has its own retry ticket: retrying a search must not also re-read
  // the address book, and retrying the address book must not re-run a search.
  const [contactsRetry, setContactsRetry] = useState(0);
  const [searchRetry, setSearchRetry] = useState(0);

  useEffect(() => {
    const ticket = ++contactsSequence.current;
    void searchContacts()
      .then((result) => {
        if (ticket !== contactsSequence.current) return;
        setContacts({ contacts: result.people, error: null });
      })
      .catch((failure: unknown) => {
        if (ticket !== contactsSequence.current) return;
        setContacts({ contacts: [], error: failureText(failure) });
      });
  }, [contactsRetry]);

  const needle = query.trim();

  useEffect(() => {
    if (needle.length === 0) return;
    const searched = needle;
    const ticket = ++searchSequence.current;
    const timer = setTimeout(() => {
      void searchContacts({ query: searched, limit: 20 })
        .then((result) => {
          if (ticket !== searchSequence.current) return;
          setAnswer({ key: searched, people: result.people, chats: result.chats, error: null });
        })
        .catch((failure: unknown) => {
          if (ticket !== searchSequence.current) return;
          setAnswer({ key: searched, people: [], chats: [], error: failureText(failure) });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [needle, searchRetry]);

  const current = needle.length === 0 ? null : answer !== null && answer.key === needle ? answer : null;
  const retry = useCallback((): void => {
    // Clearing the failed answer is what puts the spinner back while the retry
    // is in flight; the effect's ticket makes a slower old answer harmless.
    if (needle.length === 0) {
      setContacts(null);
      setContactsRetry((count) => count + 1);
      return;
    }
    setAnswer(null);
    setSearchRetry((count) => count + 1);
  }, [needle]);

  if (needle.length === 0) {
    return {
      query,
      setQuery,
      contacts: contacts?.contacts ?? [],
      people: [],
      chats: [],
      loading: contacts === null,
      error: contacts?.error ?? null,
      retry,
    };
  }

  return {
    query,
    setQuery,
    contacts: contacts?.contacts ?? [],
    people: current?.people ?? [],
    chats: current?.chats ?? [],
    loading: current === null,
    error: current?.error ?? null,
    retry,
  };
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
