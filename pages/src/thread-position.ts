import { useMemo, useRef } from 'react';
import { messageRowSelector } from './groups';
import type { PeerId } from './types';

/**
 * Where a thread was left: the message at the top of the viewport and its
 * offset, with the raw scroll position as a fallback. The anchor keeps the
 * spot stable when media above it settles while the thread is away; the
 * bottom flag lets a reader who was following the newest messages return to
 * the bottom after new ones arrived.
 *
 * Kept apart from the view because the comments detour is the one navigation
 * that unmounts the thread while keeping its loaded window: remembering and
 * resuming that position is the reader-visible half of the rule.
 */

/**
 * The list counts as "at the bottom" within this many pixels, for both the
 * stick-to-bottom pin and the read watermark.
 */
export const BOTTOM_PX = 80;

export interface ThreadPosition {
  chatId: PeerId;
  /**
   * The first message at or below the viewport's top edge, or null when the
   * window rendered no message rows.
   */
  messageId: number | null;
  /**
   * That message's top edge relative to the scroll container's top edge; a
   * partially visible row is negative.
   */
  offset: number;
  /**
   * The raw position, used when the anchor message is no longer loaded.
   */
  scrollTop: number;
  /**
   * Whether the view followed the newest messages, so a resume can settle on
   * the bottom even if messages arrived meanwhile.
   */
  atBottom: boolean;
}

export interface ThreadPositionMemory {
  remember: (position: ThreadPosition) => void;
  /**
   * The remembered position for `chatId`, if the open thread is the session
   * that was left; null when the thread has since been opened or closed.
   */
  resume: (chatId: PeerId) => ThreadPosition | null;
  /**
   * Drops the remembered position: a fresh open or a close is a new session.
   */
  forget: () => void;
}

export function useThreadPositionMemory(): ThreadPositionMemory {
  const position = useRef<ThreadPosition | null>(null);
  return useMemo(
    () => ({
      remember: (next: ThreadPosition): void => {
        position.current = next;
      },
      resume: (chatId: PeerId): ThreadPosition | null => (position.current?.chatId === chatId ? position.current : null),
      forget: (): void => {
        position.current = null;
      },
    }),
    [],
  );
}

export function isAtBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_PX;
}

/**
 * Reads the current viewport as a resumable position. The first message row
 * whose bottom edge is inside the container anchors the spot; an album is one
 * row, and its first message id resolves back to the same element.
 */
export function readThreadPosition(element: HTMLElement, chatId: PeerId): ThreadPosition {
  const container = element.getBoundingClientRect();
  let messageId: number | null = null;
  let offset = 0;
  for (const row of element.querySelectorAll<HTMLElement>('[data-message-ids]')) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= container.top) continue;
    const id = Number(row.dataset.messageIds?.split(' ', 1)[0]);
    if (Number.isSafeInteger(id) && id > 0) messageId = id;
    offset = rect.top - container.top;
    break;
  }
  return { chatId, messageId, offset, scrollTop: element.scrollTop, atBottom: isAtBottom(element) };
}

/**
 * Puts a saved position back. A bottom reader follows any messages that
 * arrived meanwhile; an anchored reader keeps the same message at the same
 * offset, even if media above it changed size. The raw scroll position is the
 * fallback when the anchor is gone.
 */
export function restoreThreadPosition(element: HTMLElement, position: ThreadPosition): void {
  if (position.atBottom) {
    element.scrollTop = element.scrollHeight;
    return;
  }
  const target = position.messageId === null ? null : element.querySelector<HTMLElement>(messageRowSelector(position.messageId));
  if (!target) {
    element.scrollTop = position.scrollTop;
    return;
  }
  const container = element.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  element.scrollTop += rect.top - container.top - position.offset;
}

export interface ThreadOpening {
  focusMessageId: number | null;
  unreadDividerId: number | null;
  /**
   * A position to resume before any of the defaults applies: the comments
   * screen took the reader away without closing the thread.
   */
  resume: ThreadPosition | null;
}

/**
 * Lands an opened (or reopened) thread: a remembered position wins, then a
 * linked post, then the unread divider, then the bottom.
 */
export function positionThread(element: HTMLElement, opening: ThreadOpening): void {
  if (opening.resume !== null) {
    restoreThreadPosition(element, opening.resume);
    return;
  }
  const focus = opening.focusMessageId === null ? null : element.querySelector<HTMLElement>(messageRowSelector(opening.focusMessageId));
  if (focus) {
    focus.scrollIntoView({ block: 'center' });
    flashRow(focus);
    return;
  }
  // The divider is the opening position; without one the thread was fully
  // read and lands at the bottom. A divider whose message sits outside the
  // loaded window (a jump window) falls back to the row.
  const divider = element.querySelector<HTMLElement>('[data-unread-divider]');
  const anchor =
    divider ?? (opening.unreadDividerId === null ? null : element.querySelector<HTMLElement>(messageRowSelector(opening.unreadDividerId)));
  if (anchor) anchor.scrollIntoView({ block: 'start' });
  else element.scrollTop = element.scrollHeight;
}

/**
Flashes a row, so a programmatic jump reads as a jump rather than a no-op.
*/
export function flashRow(element: HTMLElement): void {
  element.classList.add('reply-flash');
  setTimeout(() => element.classList.remove('reply-flash'), 1200);
}
