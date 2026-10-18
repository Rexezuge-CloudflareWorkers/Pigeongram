import type { DialogDto, MessageDto, PeerId } from './types';

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
