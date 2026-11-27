import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loginPhaseMessage } from '../../apps/web/src/login-copy';
import { formatListStamp, formatPresence, mediaPreview, pollPreview, previewOf } from '../../apps/web/src/format';
import type { MessagePollDto, PresenceDto } from '../../apps/web/src/types';

/**
The visible-copy style: every word of authored, user-visible text is
capitalised, including articles, prepositions and conjunctions. Accessible
only copy keeps sentence case, because it is not visible text.

The copy now lives in `apps/web/src/locales/en/translation.json` rather than
in JSX text nodes, so the guard reads the catalogue. Two rules:

- A key outside the `a11y` namespace is **visible** copy and must be Title
  Case. That is where a translator or an extractor landing here would slip.
- A key inside `a11y` is **accessible-only** copy (`aria-label`, `title`,
  `alt`, spinner labels) and must *not* be forced into Title Case.

Dynamic values (chat titles, dates, counters, units) are interpolated, so a
`{{placeholder}}` token is skipped by the casing walk exactly as a JSX
expression used to be.
*/

// The suite's working directory is the repository root (Vitest's `root`), and
// an `import.meta.url` under the test transform is not a file URL.
const WEB_SRC = path.resolve(process.cwd(), 'apps/web/src');
const CATALOGUE = path.resolve(WEB_SRC, 'locales/en/translation.json');

/**
Unit suffixes that legitimately follow a dynamic value: `${n}s`, `${n}m`.
*/
const UNIT_SUFFIXES = new Set(['s', 'm', 'h', 'd']);

function isTitleCased(text: string): boolean {
  for (const rawToken of text.split(/\s+/)) {
    // An interpolation is data, not authored copy.
    if (rawToken.includes('{{')) continue;
    const start = rawToken.search(/[\p{L}\p{N}]/u);
    if (start === -1) continue;
    const token = rawToken.slice(start);
    // A counter or a unit (`5m`, `30s`, `1.2K`) starts with a digit and is
    // data, not authored copy.
    if (/^\p{N}/u.test(token) || UNIT_SUFFIXES.has(token)) continue;
    // A hyphenated compound is one word, so every segment is capitalised
    // (`Diffie-Hellman`, `Single-Account`); a contraction only needs its first
    // letter (`You'll`).
    for (const segment of token.split('-')) {
      const first = /\p{L}/u.exec(segment)?.[0];
      if (first !== undefined && first !== first.toUpperCase()) return false;
    }
  }
  return true;
}

function hasCopy(text: string): boolean {
  return /\p{L}/u.test(text);
}

interface CatalogueEntry {
  /**
  Dotted key, `namespace.name`.
  */
  key: string;
  value: string;
}

/**
Every leaf of the catalogue, with its dotted key.
*/
function entries(node: Record<string, unknown>, prefix = '', out: CatalogueEntry[] = []): CatalogueEntry[] {
  for (const [name, value] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) entries(value as Record<string, unknown>, key, out);
    else if (typeof value === 'string') out.push({ key, value });
  }
  return out;
}

const CATALOGUE_ENTRIES = entries(JSON.parse(readFileSync(CATALOGUE, 'utf8')) as Record<string, unknown>);

/**
Whether a key is accessible-only copy, and so outside the Title Case rule.
*/
function isAccessibleOnly(key: string): boolean {
  return key.startsWith('a11y.');
}

function presence(lastSeenAt: number | null, status: PresenceDto['status']): PresenceDto {
  return { status, lastSeenAt };
}

const POLL: MessagePollDto = {
  id: '1',
  question: 'Where?',
  answers: [],
  totalVoters: 0,
  closed: false,
  quiz: false,
  multiple: false,
  revotingDisabled: false,
  hideResultsUntilClose: false,
  solution: null,
};

describe('visible copy style', () => {
  it('reads a catalogue that actually carries copy', () => {
    // A guard over an empty or unreadable catalogue would pass forever.
    expect(CATALOGUE_ENTRIES.length).toBeGreaterThan(150);
    expect(CATALOGUE_ENTRIES.every((entry) => entry.value.length > 0)).toBe(true);
  });

  it('title-cases every visible catalogue value', () => {
    const offenders = CATALOGUE_ENTRIES.filter(
      (entry) => !isAccessibleOnly(entry.key) && hasCopy(entry.value) && !isTitleCased(entry.value),
    ).map((entry) => `${entry.key} — ${entry.value}`);
    expect(offenders).toEqual([]);
  });

  it('keeps accessible-only copy under the a11y namespace rather than title-casing it', () => {
    // The boundary is the namespace, not a heuristic: a new `aria-label` key
    // added outside `a11y` would be held to the visible rule, and one added
    // inside it is deliberately exempt.
    const accessible = CATALOGUE_ENTRIES.filter((entry) => isAccessibleOnly(entry.key));
    expect(accessible.length).toBeGreaterThan(20);
  });

  it('title-cases authored presence and preview helpers', () => {
    expect(formatPresence(presence(null, 'online'))).toBe('Online');
    expect(formatPresence(presence(null, 'recently'))).toBe('Last Seen Recently');
    expect(formatPresence(presence(null, 'within_week'))).toBe('Last Seen Within A Week');
    expect(formatPresence(presence(null, 'within_month'))).toBe('Last Seen Within A Month');
    expect(formatPresence(presence(0, 'offline'))).toMatch(/^Last Seen .+ At .+$/);
    expect(mediaPreview('voice')).toBe('Voice Message');
    expect(mediaPreview('unsupported')).toBe('Unsupported Message');
    expect(pollPreview(POLL)).toBe('Poll: Where?');
    expect(formatListStamp(Date.now())).toBe('Now');
    expect(previewOf('', null, POLL)).toBe('Poll: Where?');
  });

  it('title-cases the authored login phases', () => {
    expect(loginPhaseMessage(null)).toBe('Connecting To The Session Engine…');
    expect(loginPhaseMessage({ phase: 'qr', authorized: false, me: null })).toMatch(/^Scan This QR Code From Telegram/);
    expect(loginPhaseMessage({ phase: 'code', authorized: false, me: null, codeType: 'app' })).toBe(
      'Telegram Sent A Login Code To Your Telegram App — Type It Below',
    );
    expect(loginPhaseMessage({ phase: 'password', authorized: false, me: null })).toBe(
      'Two-Step Verification: Enter Your Telegram Cloud Password',
    );
  });
});
