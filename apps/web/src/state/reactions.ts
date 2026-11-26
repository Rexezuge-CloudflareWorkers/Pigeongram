import type { MessageDto, MessageReactionDto, PeerId } from '../types';

/**
Reaction and view folds shared by the chat list, the thread and the comments.

These are pure list transforms over loaded messages: a live update carries no
full message, so a message that is not on screen is left alone. Keeping them
out of `state/index.ts` gives the chat-list folds one concern each.
*/

/**
Stable identity of a reaction aggregate: the emoji, or the custom id.
*/
export function reactionKey(reaction: MessageReactionDto): string {
  return reaction.emoji ?? `custom:${reaction.customEmojiId ?? ''}`;
}

/**
Replaces one message's reaction aggregates.
*/
export function applyReactionUpdate(
  messages: MessageDto[],
  chatId: PeerId,
  messageId: number,
  reactions: MessageReactionDto[],
): MessageDto[] {
  return messages.map((message) => (message.chatId === chatId && message.id === messageId ? { ...message, reactions } : message));
}

/**
Replaces one message's view count.
*/
export function applyViewsUpdate(messages: MessageDto[], chatId: PeerId, messageId: number, views: number): MessageDto[] {
  return messages.map((message) => (message.chatId === chatId && message.id === messageId ? { ...message, views } : message));
}

/**
Optimistic reaction toggle: flips the tapped reaction, clears the previously
chosen one (Telegram allows one), and drops aggregates whose count reached zero.
*/
export function toggleReaction(reactions: MessageReactionDto[], reaction: MessageReactionDto): MessageReactionDto[] {
  const key = reactionKey(reaction);
  const exists = reactions.some((candidate) => reactionKey(candidate) === key);
  const next = reactions.map((candidate) => {
    if (reactionKey(candidate) === key) {
      return { ...candidate, chosen: !candidate.chosen, count: candidate.count + (candidate.chosen ? -1 : 1) };
    }
    return candidate.chosen ? { ...candidate, chosen: false, count: candidate.count - 1 } : candidate;
  });
  if (!exists) {
    next.push({
      emoji: reaction.emoji,
      customEmojiId: reaction.customEmojiId,
      count: 1,
      chosen: true,
    });
  }
  return next.filter((candidate) => candidate.count > 0);
}
