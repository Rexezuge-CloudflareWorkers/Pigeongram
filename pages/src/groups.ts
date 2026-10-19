import type { MessageDto } from './types';

/**
Album grouping for display.
 *
Telegram delivers one album as several real messages that share a `groupedId`.
The UI renders them as one bubble, but every message stays addressable:
reactions, read receipts and replies all remain per message. Kept pure so the
split can be reasoned about (and tested) without rendering anything.
*/

/**
Splits an id-sorted thread into display groups: each group is one album's
consecutive messages, or a singleton for everything else. Consecutive runs
(rather than a lookup by group id) also join an album back together when a
paging window arrives in two halves.
*/
export function groupMessages(messages: readonly MessageDto[]): MessageDto[][] {
  const groups: MessageDto[][] = [];
  for (const message of messages) {
    const group = groups.at(-1);
    const groupedId = message.groupedId;
    // A missing `groupedId` (a cached SPA against the previous worker) must not
    // glue unrelated messages together: only a real string joins a group.
    if (group && typeof groupedId === 'string' && group.at(-1)?.groupedId === groupedId) {
      group.push(message);
    } else {
      groups.push([message]);
    }
  }
  return groups;
}

/**
The album's caption, following Telegram's rule for photo albums: exactly one
member carrying text makes that the caption (senders normally put it on the
first item). Two or more are per-file captions — for visual albums Telegram
hides them all, so this returns null.
*/
export function albumCaption(group: readonly MessageDto[]): MessageDto | null {
  const captioned = group.filter((message) => message.text.length > 0);
  return captioned.length === 1 ? captioned[0] : null;
}

/**
Whether an album renders as a media grid rather than stacked file rows: every
item is a photo, video or GIF-style animation.
*/
export function isVisualAlbum(group: readonly MessageDto[]): boolean {
  return group.every(
    (message) =>
      message.media !== null && (message.media.kind === 'photo' || message.media.kind === 'video' || message.media.kind === 'animation'),
  );
}

/**
Selector for the bubble that renders a message. Album members share one
element, so a jump to any member has to resolve to its group.
*/
export function messageRowSelector(messageId: number): string {
  return `[data-message-ids~="${CSS.escape(String(messageId))}"]`;
}
