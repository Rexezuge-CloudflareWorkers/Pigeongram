import type { DialogDto, MessageDto, MessageReactionDto, PeerId } from './types';

/**
 * Pure list surgery for the SPA's chat and message state. Kept in its own
 * module so it can be unit-tested without rendering anything.
 */

/**
Applies a live `new_message` update: unread bump, last-message, reorder.
*/
export function applyNewMessage(dialogs: DialogDto[], message: MessageDto, activeChatId: PeerId | null): DialogDto[] {
  const index = dialogs.findIndex((dialog) => dialog.chat.id === message.chatId);
  if (index === -1) return dialogs;

  const dialog = dialogs[index];
  const read = message.outgoing || message.chatId === activeChatId;
  const updated: DialogDto = {
    ...dialog,
    lastMessage: message,
    unread: read ? dialog.unread : dialog.unread + 1,
  };

  if (updated.pinned) {
    return dialogs.map((candidate, candidateIndex) => (candidateIndex === index ? updated : candidate));
  }
  const rest = dialogs.filter((_, candidateIndex) => candidateIndex !== index);
  const pinnedCount = rest.filter((candidate) => candidate.pinned).length;
  rest.splice(pinnedCount, 0, updated);
  return rest;
}

export function applyEditedMessage(dialogs: DialogDto[], message: MessageDto): DialogDto[] {
  return dialogs.map((dialog) =>
    dialog.chat.id === message.chatId && dialog.lastMessage?.id === message.id ? { ...dialog, lastMessage: message } : dialog,
  );
}

export function applyReadUpdate(dialogs: DialogDto[], chatId: PeerId, unread: number): DialogDto[] {
  return dialogs.map((dialog) => (dialog.chat.id === chatId ? { ...dialog, unread } : dialog));
}

/**
Merges message batches by id, oldest first (ids are monotonic per chat).
*/
export function mergeMessages(existing: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  const byId = new Map<number, MessageDto>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
Replaces one message in place (kept for edited messages).
*/
export function replaceMessage(messages: MessageDto[], message: MessageDto): MessageDto[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index === -1) return mergeMessages(messages, [message]);
  const next = [...messages];
  next[index] = message;
  return next;
}

export function findChatTitle(dialogs: DialogDto[], chatId: PeerId): string | null {
  return dialogs.find((dialog) => dialog.chat.id === chatId)?.chat.title ?? null;
}

/**
Stable identity of a reaction aggregate: the unicode emoji, or the custom
emoji document id.
*/
export function reactionKey(reaction: MessageReactionDto): string {
  return reaction.emoji ?? `custom:${reaction.customEmojiId ?? ''}`;
}

/**
Replaces one message's reaction aggregates. Reaction updates carry no full
message, so the message is found by `chatId`/`messageId` and left untouched
when it is not loaded.
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
Optimistic reaction toggle, applied before the RPC round trip: flips the tapped
reaction on, clears the previously chosen one (Telegram allows one), and drops
aggregates whose count reached zero.
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
