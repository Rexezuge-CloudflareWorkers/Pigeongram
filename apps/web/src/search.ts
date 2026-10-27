import type { PeerId, SearchGlobalCursor } from './types';

/**
 * The search screen's own shapes: what is being searched, where the next page
 * starts, and how a result's text is split around the query for highlighting.
 */

/**
 * What a search covers: every chat the account can search, or one chat.
 */
export type SearchScope = { kind: 'all' } | { kind: 'chat'; chatId: PeerId };

/**
 * The cursor of the next page, tagged with the read that produced it so the
 * two searches cannot mix their pagination.
 */
export type SearchNext = { kind: 'global'; offset: SearchGlobalCursor } | { kind: 'chat'; offsetId: number };

/**
 * A piece of a result's text, marked when it is part of a query match.
 */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Splits `text` around the case-insensitive occurrences of `query`.
 *
 * The query is trimmed, because a search ignores leading and trailing spaces;
 * an empty query leaves the whole text as one unmarked segment. Adjacent
 * matches stay separate segments, so the caller can render each one.
 */
export function highlightMatches(text: string, query: string): HighlightSegment[] {
  const needle = query.trim();
  if (needle.length === 0) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const lowered = needle.toLowerCase();
  const segments: HighlightSegment[] = [];
  let index = 0;
  while (index < text.length) {
    const found = haystack.indexOf(lowered, index);
    if (found === -1) {
      segments.push({ text: text.slice(index), match: false });
      break;
    }
    if (found > index) segments.push({ text: text.slice(index, found), match: false });
    segments.push({ text: text.slice(found, found + needle.length), match: true });
    index = found + needle.length;
  }
  return segments;
}
