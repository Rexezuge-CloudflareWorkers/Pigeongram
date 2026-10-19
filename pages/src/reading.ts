import type { MessageDto } from './types';

/**
 * Where reading stopped in a thread: the first unread message and the water
 * mark a scroll position proves read. Kept DOM-free so the open jump, the
 * divider and the read receipts can be reasoned about (and tested) on their
 * own; `ThreadView` only turns the scroll container into `visibleIds`.
 */

/**
The thread's first unread message: the earliest incoming message after the
watermark a chat opened at. Used for the unread divider, which marks where
reading stopped when the chat was opened. Null when the window is all read.
*/
export function firstUnread(messages: readonly MessageDto[], readInboxMaxId: number): MessageDto | null {
  return messages.find((message) => !message.outgoing && message.id > readInboxMaxId) ?? null;
}

/**
The highest incoming message id a viewport proves read: the newest incoming
message when the list is scrolled to the bottom, otherwise the last visible
one. Null when no incoming message qualifies, so the caller has nothing to
report.
*/
export function readWatermark(messages: readonly MessageDto[], visibleIds: ReadonlySet<number>, atBottom: boolean): number | null {
  let watermark: number | null = null;
  for (const message of messages) {
    if (message.outgoing) continue;
    // Ids are monotonic per chat, so the last match is the highest one.
    if (atBottom || visibleIds.has(message.id)) watermark = message.id;
  }
  return watermark;
}
