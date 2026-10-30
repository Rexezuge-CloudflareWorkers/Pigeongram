import { describe, expect, it } from 'vitest';
import { EDGE_RESISTANCE, followOffset, SWIPE_MIN_PX, swipeAxis, swipeDirection } from '../../apps/web/src/gallery-swipe';

/**
 * The viewer's gallery swipe arithmetic. A wrong axis turns a vertical drag
 * into a navigation; a wrong threshold commits too early; a wrong edge factor
 * makes the ends feel like the media is stuck.
 */

describe('swipeAxis', () => {
  it('waits for the slop before calling an axis', () => {
    expect(swipeAxis(4, 2)).toBeNull();
    expect(swipeAxis(-4, -2)).toBeNull();
  });

  it('takes the dominant axis and gives a diagonal to the vertical one', () => {
    expect(swipeAxis(40, 10)).toBe('horizontal');
    expect(swipeAxis(-40, 10)).toBe('horizontal');
    expect(swipeAxis(10, 40)).toBe('vertical');
    expect(swipeAxis(30, 30)).toBe('vertical');
  });
});

describe('followOffset', () => {
  it('follows the finger between neighbours', () => {
    expect(followOffset(-80, true, true)).toBe(-80);
    expect(followOffset(80, true, true)).toBe(80);
  });

  it('damps a drag towards a neighbour the album does not have', () => {
    expect(followOffset(-100, true, false)).toBe(-100 * EDGE_RESISTANCE);
    expect(followOffset(100, false, true)).toBe(100 * EDGE_RESISTANCE);
  });

  it('leaves a still finger alone', () => {
    expect(followOffset(0, false, false)).toBe(0);
  });
});

describe('swipeDirection', () => {
  it('commits left to the next item and right to the previous one', () => {
    expect(swipeDirection(-SWIPE_MIN_PX, 0)).toBe(1);
    expect(swipeDirection(SWIPE_MIN_PX, 0)).toBe(-1);
  });

  it('ignores a short, vertical or diagonal drag', () => {
    expect(swipeDirection(-(SWIPE_MIN_PX - 1), 0)).toBeNull();
    expect(swipeDirection(-100, 80)).toBeNull();
    expect(swipeDirection(-100, -80)).toBeNull();
  });
});
