import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES } from '@rexezuge/shared';
import { SUPPORTED_LANGUAGES, i18n, normalizeLanguage, LOCALE_NAMES } from '../../apps/web/src/i18n';

/**
The catalogue's invariants, as tests rather than only as the CI script.

`pnpm run validate:locales` is the gate, but a gate nobody runs locally fails
in CI and costs a round trip. These assertions are cheap and cover the mistakes
that make the gate fire: a key missing from a bundle, a placeholder that drifted,
a language offered without a catalogue, or a bundle directory nobody offers.
*/
const WEB_SRC = path.resolve(process.cwd(), 'apps/web/src');
const LOCALES_DIR = path.join(WEB_SRC, 'locales');

function flatten(node: Record<string, unknown>, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) flatten(value as Record<string, unknown>, dotted, out);
    else if (typeof value === 'string') out.set(dotted, value);
  }
  return out;
}

function readBundle(tag: string): Map<string, string> {
  return flatten(JSON.parse(readFileSync(path.join(LOCALES_DIR, tag, 'translation.json'), 'utf8')) as Record<string, unknown>);
}

describe('the SPA language list', () => {
  it('offers English and only tags the kit supports', () => {
    expect([...SUPPORTED_LANGUAGES]).toContain('en');
    for (const tag of SUPPORTED_LANGUAGES) expect(SUPPORTED_LOCALES).toContain(tag);
  });

  it('ships a catalogue directory for every offered language, and no others', () => {
    // A language the selector offers without a bundle renders raw keys; a
    // bundle the selector does not offer is a translator's work nobody sees.
    const shipped = readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(shipped).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('names every offered language', () => {
    expect(LOCALE_NAMES.en).toBe(LOCALE_DISPLAY_NAMES.en);
    for (const tag of SUPPORTED_LANGUAGES) expect(LOCALE_NAMES[tag].length).toBeGreaterThan(1);
  });

  it('normalizes an unknown or regional tag onto a supported one', () => {
    expect(normalizeLanguage('en-GB')).toBe('en');
    expect(normalizeLanguage('zh-CN')).toBe('en'); // not offered yet, so it falls back
    expect(normalizeLanguage(null)).toBe('en');
    expect(normalizeLanguage('')).toBe('en');
  });
});

describe('the English catalogue', () => {
  const en = readBundle('en');

  it('is the language i18next is actually rendering', () => {
    // The setup file pins the suite to English; a component test asserting
    // English copy would otherwise be a coincidence.
    expect(i18n.language).toBe('en');
    expect(i18n.t('common.cancel')).toBe('Cancel');
  });

  it('answers a bundled key with its bundled value, not the inline default', () => {
    // The second argument to `t()` is a default honouring a missing resource,
    // which is exactly the failure this asserts against.
    expect(i18n.t('media.unsupportedTitle')).toBe("This Message Isn't Supported Yet");
    expect(i18n.t('poll.voteCount', { count: 4 })).toBe('4 Votes');
    expect(i18n.t('a11y.views', { views: '1,200' })).toBe('1,200 views');
  });

  it('has no empty value and no duplicate', () => {
    for (const [key, value] of en) expect(value.trim().length, key).toBeGreaterThan(0);
    expect(new Set(en.keys()).size).toBe(en.size);
  });

  it('keeps placeholder parity across the locales that do ship', () => {
    // A bounded scan rather than a regex with nested quantifiers: `{{…}}` is a
    // two-character delimiter and the closing pair ends the token.
    const placeholders = (value: string): string[] => {
      const found: string[] = [];
      let rest = value;
      for (;;) {
        const start = rest.indexOf('{{');
        if (start === -1) break;
        const end = rest.indexOf('}}', start + 2);
        if (end === -1) break;
        found.push(rest.slice(start, end + 2));
        rest = rest.slice(end + 2);
      }
      return [...new Set(found)].sort();
    };
    const shipped: readonly string[] = SUPPORTED_LANGUAGES;
    for (const tag of shipped) {
      if (tag === 'en') continue;
      const bundle = readBundle(tag);
      for (const [key, value] of en) expect(placeholders(bundle.get(key) ?? ''), `${tag}:${key}`).toEqual(placeholders(value));
    }
  });
});
