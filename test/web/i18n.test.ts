import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES } from '@rexezuge/shared';
import { SUPPORTED_LANGUAGES, i18n, normalizeLanguage, LOCALE_NAMES } from '../../apps/web/src/i18n';
import { formatBytes, formatCount, formatListStamp, formatNumber } from '../../apps/web/src/format';

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
    expect(normalizeLanguage('zh')).toBe('zh-CN');
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguage('zh-TW')).toBe('zh-TW');
    expect(normalizeLanguage('de-AT')).toBe('de');
    expect(normalizeLanguage(null)).toBe('en');
    expect(normalizeLanguage('')).toBe('en');
    expect(normalizeLanguage('xx')).toBe('en');
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

  it('is actually translated in every shipped bundle', () => {
    // Parity alone would pass for eleven copies of the English file. Shared
    // product names and literals account for only a handful of values.
    for (const tag of SUPPORTED_LANGUAGES) {
      if (tag === 'en') continue;
      const bundle = readBundle(tag);
      const translated = [...en].filter(([key, value]) => bundle.get(key) !== value).length;
      expect(translated / en.size, tag).toBeGreaterThan(0.8);
    }
  });

  it('covers the toast and accessible copy extracted from the components', () => {
    // These used to be literals in hooks and JSX; the English bundle is the
    // single copy they now come from, literal defaults included.
    expect(i18n.t('messages.copiedToClipboard')).toBe('Copied To Clipboard');
    expect(i18n.t('dialogs.chatArchived')).toBe('Chat Archived');
    expect(i18n.t('errors.commentsRead')).toBe('The Comments Could Not Be Read');
    expect(i18n.t('stickers.packInstalled', { title: 'Utya Duck' })).toBe('Sticker Pack Installed: Utya Duck');
    expect(i18n.t('a11y.buttonNeedsPassword')).toBe('This button needs your Telegram password; press it in the native app.');
    expect(i18n.t('a11y.buttonSending')).toBe('Sending…');
    expect(i18n.t('a11y.photoNoun')).toBe('photo');
    expect(i18n.t('a11y.seedTelegram')).toBe('Telegram Blue');
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

/**
Plural categories and number formatting are part of the language choice, not
of the browser: a German reader sees a German decimal separator and a Polish
reader gets the few/many forms. The suite runs in English everywhere else, so
each case puts the language back when it is done.
*/
describe('locale-aware formatting', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('uses the language’s plural categories rather than an English count === 1 check', async () => {
    await i18n.changeLanguage('pl');
    const word = (count: number): string => i18n.t('poll.voteCount', { count }).replaceAll(/[\d\s.,]+/g, '');
    const one = word(1);
    const few = word(2);
    const many = word(5);
    expect(one).not.toBe(few);
    expect(few).not.toBe(many);
    expect(word(22)).toBe(few);

    await i18n.changeLanguage('fr');
    // French treats zero as singular, English does not.
    const french = (count: number): string => i18n.t('poll.voteCount', { count }).replaceAll(/[\d\s.,]+/g, '');
    expect(french(0)).toBe(french(1));
    expect(french(2)).not.toBe(french(1));

    await i18n.changeLanguage('ja');
    // Japanese has only the `other` category, so every count reads the same.
    const japanese = (count: number): string => i18n.t('poll.voteCount', { count }).replaceAll(/[\d\s.,]+/g, '');
    expect(japanese(1)).toBe(japanese(2));
  });

  it('formats numbers with the chosen language and keeps compact units short', async () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatCount(1200)).toBe('1.2K');
    expect(formatListStamp(Date.now() - 5 * 60_000)).toBe('5m');

    await i18n.changeLanguage('de');
    expect(formatNumber(1234)).toBe('1.234');
    expect(formatBytes(2048)).toBe('2,0 KB');
    expect(formatCount(1200)).toBe('1,2K');
  });

  it('translates the extracted button explanations and toast copy', async () => {
    await i18n.changeLanguage('de');
    expect(i18n.t('a11y.gameNeedsApp')).toBe('Telegram-Spiele benötigen die native App.');
    expect(i18n.t('messages.copiedToClipboard')).toBe('In die Zwischenablage kopiert');
    expect(i18n.t('dialogs.chatArchived')).toBe('Chat archiviert');
    expect(i18n.t('stickers.packInstalled', { title: 'Utya Duck' })).toBe('Sticker-Paket installiert: Utya Duck');
  });

  it('renders a grouped count inside a plural string', async () => {
    expect(i18n.t('thread.commentCount', { count: 1234 })).toContain('1,234');
    await i18n.changeLanguage('de');
    expect(i18n.t('thread.commentCount', { count: 1234 })).toContain('1.234');
  });
});
