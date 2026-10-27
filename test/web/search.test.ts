import { describe, expect, it } from 'vitest';
import { highlightMatches } from '../../apps/web/src/search';

describe('highlightMatches', () => {
  it('marks every case-insensitive occurrence of the query', () => {
    expect(highlightMatches('Cloudflare and cloudflare', 'cloudflare')).toEqual([
      { text: 'Cloudflare', match: true },
      { text: ' and ', match: false },
      { text: 'cloudflare', match: true },
    ]);
  });

  it('leaves the whole text unmarked for a blank query', () => {
    expect(highlightMatches('anything', ' '.repeat(3))).toEqual([{ text: 'anything', match: false }]);
    expect(highlightMatches('', 'tag')).toEqual([]);
  });

  it('keeps adjacent matches separate and the trailing text plain', () => {
    expect(highlightMatches('aaaa', 'aa')).toEqual([
      { text: 'aa', match: true },
      { text: 'aa', match: true },
    ]);
    expect(highlightMatches('tag!', 'tag')).toEqual([
      { text: 'tag', match: true },
      { text: '!', match: false },
    ]);
  });

  it('returns the text untouched when the query is absent', () => {
    expect(highlightMatches('nothing here', 'tag')).toEqual([{ text: 'nothing here', match: false }]);
  });
});
