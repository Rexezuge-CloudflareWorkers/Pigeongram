import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * The rules of paging a loaded window by scrolling up.
 *
 * The next older page is fetched a viewport before the reader reaches the top,
 * so the content is usually already there when they do. Prepending a page
 * shifts the loaded messages down; the anchor below keeps the row the reader
 * was looking at in place. The list disables the browser's own scroll
 * anchoring, so the correction behaves the same in every browser.
 */

/**
 * How close to the top counts as asking for the older page: one viewport of
 * preload. The scroll container is passed rather than read from globals so the
 * thread and the comments screen share the rule.
 */
export function isNearTop(element: HTMLElement): boolean {
  return element.scrollTop < element.clientHeight;
}

interface PrependAnchor {
  scope: string | number;
  oldestId: number | null;
  height: number;
}

/**
 * Keeps the viewport on the row it shows when older messages are prepended.
 *
 * `scope` names the list (a chat, a post's comments) and `oldestId` is its
 * first loaded message. When the first id moves backwards, the height the
 * older page added above the viewport is put back into `scrollTop`. The height
 * is recorded whenever the loaded list changes, so live messages that grew it
 * before the page arrived are not mistaken for the prepend. A new scope —
 * another chat, another post — starts from scratch, so an open never inherits
 * the previous window's correction.
 */
export function usePrependAnchor(
  elementRef: RefObject<HTMLElement | null>,
  scope: string | number,
  oldestId: number | null,
  revision: number,
): void {
  const previous = useRef<PrependAnchor | null>(null);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const height = element.scrollHeight;
    const before = previous.current;
    if (before && before.scope === scope && before.oldestId !== null && oldestId !== null && oldestId < before.oldestId) {
      element.scrollTop += height - before.height;
    }
    previous.current = { scope, oldestId, height };
  }, [elementRef, oldestId, revision, scope]);
}
