import { mergeMessages, replaceMessage } from './state';
import type { ChatDto, MessageDto, PeerId } from './types';

/**
 * The open thread's state and the folds a live update or a send applies to it.
 *
 * Kept apart from `state.ts` so that module stays under the god-file cap, and
 * because the thread's two cursors — the contiguous loaded range and the
 * chat's newest known message — are what forward paging is built on.
 */

/**
The open chat and its loaded messages, held as one value so the two can never
disagree about which chat the thread belongs to.
*/
export interface ChatThread {
  chat: ChatDto;
  messages: MessageDto[];
  /**
  Id of the last read incoming message, seeded from the dialog when the chat
  opens and advanced as the user reads.
  */
  readInboxMaxId: number;
  /**
  Id of the last outgoing message the peer has read, seeded from the dialog
  and advanced by outbox read updates. Own messages up to it show a double
  check; later ones a single sent check.
  */
  readOutboxMaxId: number;
  /**
  The message the unread divider sits above: the first unread message of the
  window the chat opened with. It marks where reading stopped when the chat
  was opened, so advancing the watermark moves the badge and the receipts but
  not the line, and messages arriving later in the same session do not create
  one; reopening the chat seeds a fresh divider. Null when the opening window
  was fully read.
  */
  unreadDividerId: number | null;
  /**
  The linked post a jump landed on, until the view scrolls to it; null when the
  chat was opened normally.
  */
  focusMessageId: number | null;
  /**
  Whether history older than the loaded window may still exist.
  */
  hasMoreOlder: boolean;
  /**
  The newest message of the contiguous range the thread has loaded. It is the
  cursor forward paging continues from, so it does not move when a sent or live
  message lands beyond a gap: the gap has to be read first. Null until the
  opening window arrives.
  */
  windowEndId: number | null;
  /**
   The newest message known to exist in the chat: the dialog's last message,
   advanced by live messages and sends. Comparing it with `windowEndId` is what
   tells the view whether the loaded range reaches the newest message.
   */
  latestMessageId: number | null;
  /**
   Ids of messages that arrived after the window landed — a live message, or
   one the caller just sent — and that the view should animate in. History
   reads and paging never add to it, and it is cleared on every open, so a
   re-mount does not replay the entrance animation.
   */
  newMessageIds: ReadonlySet<number>;
}

/**
Whether the loaded range reaches the chat's newest known message. False while
an unread backlog or an older linked post leaves messages beyond the window. A
thread with no window yet has nothing to page from, so it counts as latest
until the opening read lands.
*/
export function threadReachesLatest(thread: ChatThread): boolean {
  return thread.latestMessageId === null || thread.windowEndId === null || thread.windowEndId >= thread.latestMessageId;
}

/**
Folds a live `new_message` into the thread. While the loaded range does not
reach the newest message, the message waits: appending it would put it after a
gap and let the next page's read watermark skip the messages in between. Only
the newest-known cursor advances, and the reader sees the message when forward
paging reaches it.

A message inside the contiguous range is folded even then — it belongs to what
is already loaded, not beyond it.
*/
export function applyThreadNewMessage(thread: ChatThread | null, message: MessageDto): ChatThread | null {
  if (!thread || thread.chat.id !== message.chatId) return thread;
  const latestMessageId = Math.max(thread.latestMessageId ?? 0, message.id);
  // Before the opening window arrives there is no range to be behind: keep the
  // message so it is on screen as soon as the thread paints. The open decides
  // whether it is contiguous with the window or has to wait behind a backlog.
  if (thread.windowEndId === null) {
    return { ...thread, latestMessageId, messages: mergeMessages(thread.messages, [message]) };
  }
  const insideWindow = message.id <= thread.windowEndId;
  if (!threadReachesLatest(thread) && !insideWindow) {
    return { ...thread, latestMessageId };
  }
  // An inside-window fold replaces an already-loaded row; marking it new would
  // replay the entrance animation on an existing bubble.
  const newArrival = !insideWindow && thread.messages.every((candidate) => candidate.id !== message.id);
  const newMessageIds = newArrival ? new Set(thread.newMessageIds).add(message.id) : thread.newMessageIds;
  return {
    ...thread,
    latestMessageId,
    windowEndId: Math.max(thread.windowEndId, message.id),
    messages: mergeMessages(thread.messages, [message]),
    newMessageIds,
  };
}

/**
Folds the messages the caller just sent into the thread. They always show — a
send is the reader's own action — and they advance the newest-known cursor. The
contiguous end only follows while the range already reached the newest: a send
made from inside a backlog sits beyond the gap that forward paging has to fill.
The ids animate in, but an id the thread already held does not re-animate.
*/
export function applyThreadSentMessages(thread: ChatThread | null, chatId: PeerId, messages: readonly MessageDto[]): ChatThread | null {
  if (!thread || thread.chat.id !== chatId || messages.length === 0) return thread;
  const newest = messages.reduce((id, message) => Math.max(id, message.id), 0);
  // A send the reader made lands past the window and is the reader's own
  // action; the held live message behind a gap waits, so only ids the thread
  // did not already hold can be new.
  const fresh = messages.filter((message) => thread.messages.every((candidate) => candidate.id !== message.id));
  let newMessageIds = thread.newMessageIds;
  if (fresh.length > 0) {
    const next = new Set(newMessageIds);
    for (const message of fresh) next.add(message.id);
    newMessageIds = next;
  }
  return {
    ...thread,
    latestMessageId: Math.max(thread.latestMessageId ?? 0, newest),
    ...(threadReachesLatest(thread) && { windowEndId: Math.max(thread.windowEndId ?? 0, newest) }),
    messages: mergeMessages(thread.messages, [...messages]),
    newMessageIds,
  };
}

/**
Folds an edit into the thread. An edit carries the whole message, so an id the
thread has not loaded would otherwise be appended beyond the gap by
`replaceMessage`; while the range is behind, only edits inside the loaded
window are taken.
*/
export function applyThreadEdit(thread: ChatThread | null, message: MessageDto): ChatThread | null {
  if (!thread || thread.chat.id !== message.chatId) return thread;
  if (thread.windowEndId === null) {
    // Before the window arrives, only a message already on screen (a live one
    // that raced the open) can be edited; an unknown id must not be appended.
    if (thread.messages.every((candidate) => candidate.id !== message.id)) return thread;
  } else if (!threadReachesLatest(thread) && message.id > thread.windowEndId) {
    return thread;
  }
  return { ...thread, messages: replaceMessage(thread.messages, message) };
}

/**
Folds a deletion into the thread: the loaded rows go, and the cursors that
named one of them move back to what is left.

A null `chatId` is Telegram's peerless `updateDeleteMessages`: the engine cannot
say which private chat or basic group it belongs to, so the thread takes the
fold only when it already holds one of the ids — a chat's ids are its own, which
makes a match proof. The newest-known cursor only falls when the deletion took
the message it named; a deletion beyond the loaded window leaves the range
alone, because forward paging still has to read up to it.
*/
export function applyThreadDeleted(thread: ChatThread | null, chatId: PeerId | null, messageIds: readonly number[]): ChatThread | null {
  if (!thread || messageIds.length === 0) return thread;
  if (chatId !== null && chatId !== thread.chat.id) return thread;
  const ids = new Set(messageIds);
  const messages = thread.messages.filter((message) => !ids.has(message.id));
  if (messages.length === thread.messages.length) return thread;
  const newest = messages.at(-1)?.id ?? null;
  const windowEndId = thread.windowEndId !== null && ids.has(thread.windowEndId) ? newest : thread.windowEndId;
  const latestMessageId = thread.latestMessageId !== null && ids.has(thread.latestMessageId) ? newest : thread.latestMessageId;
  const newMessageIds = new Set(thread.newMessageIds);
  for (const id of ids) newMessageIds.delete(id);
  return {
    ...thread,
    messages,
    windowEndId,
    latestMessageId,
    newMessageIds,
    unreadDividerId: thread.unreadDividerId !== null && ids.has(thread.unreadDividerId) ? null : thread.unreadDividerId,
    focusMessageId: thread.focusMessageId !== null && ids.has(thread.focusMessageId) ? null : thread.focusMessageId,
  };
}

/**
Puts messages a failed delete rolled back into the thread. The range's end and
the newest-known cursor rise again when the restored ids are newer than what is
loaded, and an id the socket already re-delivered is left as it is.
*/
export function applyThreadRestored(thread: ChatThread | null, messages: readonly MessageDto[]): ChatThread | null {
  if (!thread || messages.length === 0) return thread;
  const chatId = messages[0].chatId;
  if (thread.chat.id !== chatId) return thread;
  const fresh = messages.filter((message) => thread.messages.every((loaded) => loaded.id !== message.id));
  if (fresh.length === 0) return thread;
  const newest = fresh.reduce((id, message) => Math.max(id, message.id), 0);
  return {
    ...thread,
    messages: mergeMessages(thread.messages, fresh),
    windowEndId: Math.max(thread.windowEndId ?? 0, newest),
    latestMessageId: Math.max(thread.latestMessageId ?? 0, newest),
  };
}
