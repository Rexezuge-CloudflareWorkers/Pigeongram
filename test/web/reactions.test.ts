import { describe, expect, it } from 'vitest';
import { ALL_REACTIONS, QUICK_REACTIONS, reactionFor } from '../../pages/src/reactions';

describe('reaction catalog', () => {
  it('keeps the quick strip inside the full picker', () => {
    expect(new Set(ALL_REACTIONS).size).toBe(ALL_REACTIONS.length);
    for (const emoji of QUICK_REACTIONS) expect(ALL_REACTIONS).toContain(emoji);
  });

  it('returns the message’s own aggregate so its chosen flag drives the toggle', () => {
    const current = { emoji: '❤️', customEmojiId: null, count: 2, chosen: true };

    expect(reactionFor([current], '❤️')).toBe(current);
  });

  it('synthesizes an aggregate for an emoji the message has not received', () => {
    expect(reactionFor([], '🦄')).toEqual({ emoji: '🦄', customEmojiId: null, count: 0, chosen: false });
  });

  it('matches across the emoji variation selector', () => {
    const current = { emoji: '❤', customEmojiId: null, count: 2, chosen: true };

    expect(reactionFor([current], '❤️')).toBe(current);
  });
});
