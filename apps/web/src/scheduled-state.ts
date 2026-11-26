import type { MessageDto, UpdateEvent } from './types';

/**
The pure folds of the scheduled queue.

The queue is a list of its own: a message here is still only a promise to send,
so it never enters the thread's window or the chat list's preview. The folds are
keyed by id, which makes an echoed write and the raw update for the same change
safe to apply twice.
*/

/**
Merges a fresh read or a new message into the queue, keeping Telegram's
chronological order (the earliest send time first) and dropping duplicate ids.
*/
export function mergeScheduledMessages(current: readonly MessageDto[], incoming: readonly MessageDto[]): MessageDto[] {
  const byId = new Map<number, MessageDto>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => left.date - right.date || left.id - right.id);
}

/**
Folds one bridge event into the queue. A null answer means the event belongs to
a different chat (or is not a scheduled event) and must leave the list alone.
*/
export function applyScheduledEvent(messages: readonly MessageDto[], update: UpdateEvent): MessageDto[] | null {
  if (update.type === 'scheduled_new') return mergeScheduledMessages(messages, [update.message]);
  if (update.type === 'scheduled_edit') return mergeScheduledMessages(messages, [update.message]);
  if (update.type === 'scheduled_deleted') {
    const gone = new Set(update.messageIds);
    return messages.filter((message) => !gone.has(message.id));
  }
  return null;
}
