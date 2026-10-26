import { describe, expect, it } from 'vitest';
import { isNearBottom, isNearTop } from '../../apps/web/src/thread-paging';

/**
A scroll container with only the geometry the edge predicates read.
*/
function container(scrollTop: number, clientHeight: number, scrollHeight: number): HTMLElement {
  return { scrollTop, clientHeight, scrollHeight } as HTMLElement;
}

describe('paging edges', () => {
  it('preloads the older page within one viewport of the top', () => {
    expect(isNearTop(container(0, 500, 1500))).toBe(true);
    expect(isNearTop(container(499, 500, 1500))).toBe(true);
    expect(isNearTop(container(500, 500, 1500))).toBe(false);
  });

  it('preloads the newer page within one viewport of the end', () => {
    expect(isNearBottom(container(500, 500, 1500))).toBe(false);
    expect(isNearBottom(container(501, 500, 1500))).toBe(true);
    expect(isNearBottom(container(1000, 500, 1500))).toBe(true);
  });
});
