import type { MessageDto, MessagePollDto, PeerId } from '../types';

/**
Poll folds for loaded messages.

A `poll` update carries no full message, so the poll id is what identifies its
target when Telegram names neither the chat nor the message. These helpers are
pure so the short-update case has a direct unit test.
*/

/**
The poll a `poll` update points at.
*/
export interface PollUpdateTarget {
  chatId: PeerId | null;
  messageId: number | null;
  pollId: string;
}

/**
The loaded message a poll update belongs to, or null when it is off screen.
*/
export function findPollMessage(messages: readonly MessageDto[], target: PollUpdateTarget): MessageDto | null {
  if (target.chatId !== null && target.messageId !== null) {
    const named = messages.find((message) => message.chatId === target.chatId && message.id === target.messageId);
    if (named?.poll) return named;
  }
  return messages.find((message) => message.poll?.id === target.pollId) ?? null;
}

/**
Replaces one loaded message's poll, identified by the update's target.
*/
export function applyPollUpdate(messages: MessageDto[], target: PollUpdateTarget, poll: MessagePollDto): MessageDto[] {
  const matched = findPollMessage(messages, target);
  if (!matched) return messages;
  return messages.map((message) => (message === matched ? { ...message, poll } : message));
}
