import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, readRecentEmoji, rememberRecentEmoji, searchEmoji } from '../../apps/web/src/emoji';

/**
The composer's emoji set.

The dataset is in-repo data, not a dependency, so these cases pin the three
things a picker depends on: every category is parseable, the search matches
names and keywords, and the recents row round-trips through storage without
ever breaking a pick.
*/

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('emoji data', () => {
  it('parses every category into characters, names and keywords', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThan(5);
    for (const category of EMOJI_CATEGORIES) {
      expect(category.name).not.toBe('');
      expect(category.emoji.length).toBeGreaterThan(10);
      for (const entry of category.emoji) {
        expect(entry.char).not.toBe('');
        expect(entry.name).not.toContain('|');
        expect(entry.keywords).not.toContain(';');
      }
    }
  });

  it('searches names and keywords, and matches nothing on an empty query', () => {
    expect(searchEmoji('')).toEqual([]);
    expect(searchEmoji(' '.repeat(3))).toEqual([]);
    expect(searchEmoji('thumbs up').map((entry) => entry.char)).toEqual(['👍']);
    // A keyword the name does not carry.
    expect(searchEmoji('lol').map((entry) => entry.char)).toContain('🤣');
    expect(searchEmoji('zzzznotanemoji')).toEqual([]);
  });

  it('matches case-insensitively and escapes nothing', () => {
    expect(searchEmoji('PIZZA').map((entry) => entry.char)).toEqual(['🍕']);
  });
});

describe('recent emoji', () => {
  it('keeps the newest pick first and de-duplicates', () => {
    expect(readRecentEmoji()).toEqual([]);
    rememberRecentEmoji('😀');
    rememberRecentEmoji('🍕');
    expect(readRecentEmoji()).toEqual(['🍕', '😀']);
    expect(rememberRecentEmoji('😀')).toEqual(['😀', '🍕']);
  });

  it('caps the row and survives a stored value that is not a list', () => {
    for (let index = 0; index < 40; index += 1) rememberRecentEmoji(`e${String(index)}`);
    expect(readRecentEmoji()).toHaveLength(24);
    expect(readRecentEmoji()[0]).toBe('e39');

    localStorage.setItem('pigeongram-recent-emoji', 'not json');
    expect(readRecentEmoji()).toEqual([]);
  });
});
