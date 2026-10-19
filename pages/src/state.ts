import type { ChatDto, DialogDto, MessageDto, MessagePollDto, MessageReactionDto, PeerId } from './types';

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

/**
Folds a server inbox read into the dialogs: the remaining unread count and the
read watermark, which only ever moves forward (a stale update must not rewind
the position the thread opens at).
*/
export function applyReadUpdate(dialogs: DialogDto[], chatId: PeerId, unread: number, readInboxMaxId: number): DialogDto[] {
  return dialogs.map((dialog) =>
    dialog.chat.id === chatId ? { ...dialog, unread, readInboxMaxId: Math.max(dialog.readInboxMaxId, readInboxMaxId) } : dialog,
  );
}

/**
The optimistic half of a read receipt: advances the dialog's watermark to the
message the user just scrolled through and subtracts the incoming messages the
loaded window proves were read. The server's own `read` update settles the
exact count a moment later; this only keeps the badge from lagging behind the
view.
*/
export function applyReadThrough(dialogs: DialogDto[], chatId: PeerId, maxId: number, messages: readonly MessageDto[]): DialogDto[] {
  return dialogs.map((dialog) => {
    if (dialog.chat.id !== chatId || maxId <= dialog.readInboxMaxId) return dialog;
    const read = messages.filter((message) => !message.outgoing && message.id > dialog.readInboxMaxId && message.id <= maxId).length;
    return { ...dialog, readInboxMaxId: maxId, unread: Math.max(0, dialog.unread - read) };
  });
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

/**
The open chat and its loaded messages, held as one value so the two can never
disagree about which chat the thread belongs to.
*/
export interface ChatThread {
  chat: ChatDto;
  messages: MessageDto[];
  /**
  Id of the last read incoming message, seeded from the dialog when the chat
  opens and advanced as the user reads; the thread's first unread message is
  the first incoming one after it.
  */
  readInboxMaxId: number;
}

/**
Runs a transform against the open thread, but only while it still belongs to
`chatId`. Every thread mutation goes through here, so a live update or a late
response for a chat the user has left can never land in whichever thread is
open — message ids are per-chat, so an unguarded merge would silently mix
threads.
*/
export function updateThread(
  thread: ChatThread | null,
  chatId: PeerId,
  update: (messages: MessageDto[]) => MessageDto[],
): ChatThread | null {
  if (!thread || thread.chat.id !== chatId) return thread;
  const messages = update(thread.messages);
  return messages === thread.messages ? thread : { ...thread, messages };
}

/**
The comments screen's state: the channel post being discussed, the loaded
window of its thread and the cursor for older comments.
*/
export interface CommentsThread {
  /**
  The channel that owns the post.
  */
  chat: ChatDto;
  /**
  The post whose comments are open.
  */
  post: MessageDto;
  /**
  Marked id of the linked discussion group, once `getComments` resolved it;
  null while the thread does not exist yet.
  */
  discussionChatId: PeerId | null;
  /**
  Id of the thread's root message in the group, once resolved.
  */
  discussionMessageId: number | null;
  /**
  Loaded comments, oldest first.
  */
  comments: MessageDto[];
  /**
  Number of comments Telegram reports.
  */
  count: number;
  /**
  Cursor for older comments; null when the thread start is loaded.
  */
  nextOffset: { id: number; date: number } | null;
}

/**
Runs a transform against the open comments thread, but only while it still
belongs to `post`. Comment ids are per-group, so an unguarded merge of a late
response or live update for another post would silently mix threads.
*/
export function updateCommentsThread(
  thread: CommentsThread | null,
  post: { chatId: PeerId; messageId: number },
  update: (thread: CommentsThread) => CommentsThread,
): CommentsThread | null {
  if (!thread || thread.chat.id !== post.chatId || thread.post.id !== post.messageId) return thread;
  return update(thread);
}

/**
Whether a message arriving from the discussion group belongs to the loaded
thread: thread messages carry a reply header pointing at the root or at a
comment the view already knows.
*/
export function isThreadComment(thread: CommentsThread, message: MessageDto): boolean {
  if (thread.discussionChatId === null || message.chatId !== thread.discussionChatId) return false;
  const replyTo = message.reply?.messageId ?? null;
  if (replyTo === null) return false;
  if (replyTo === thread.discussionMessageId) return true;
  return thread.comments.some((comment) => comment.id === replyTo);
}

/**
Merges a live comment into the open thread and bumps the reported count, but
only when the thread owns the message and has not seen it yet (an outgoing
comment can arrive by socket after the send response already merged it).
*/
export function applyCommentMessage(thread: CommentsThread | null, message: MessageDto): CommentsThread | null {
  if (!thread || !isThreadComment(thread, message)) return thread;
  if (thread.comments.some((comment) => comment.id === message.id)) return thread;
  return { ...thread, comments: mergeMessages(thread.comments, [message]), count: thread.count + 1 };
}

export function applyCommentEdit(thread: CommentsThread | null, message: MessageDto): CommentsThread | null {
  if (!thread || thread.discussionChatId !== message.chatId) return thread;
  if (thread.comments.every((comment) => comment.id !== message.id)) return thread;
  return { ...thread, comments: replaceMessage(thread.comments, message) };
}

export function applyCommentReactions(
  thread: CommentsThread | null,
  chatId: PeerId,
  messageId: number,
  reactions: MessageReactionDto[],
): CommentsThread | null {
  if (!thread || thread.discussionChatId !== chatId) return thread;
  if (thread.comments.every((comment) => comment.id !== messageId)) return thread;
  return { ...thread, comments: applyReactionUpdate(thread.comments, chatId, messageId, reactions) };
}

/**
Bumps a loaded channel post's comment count by one after one of the caller's
own comments was sent. Counts carried by live updates are not mapped back to
posts (that would need the thread root id), so they stay as fresh as the last
load plus the caller's own sends.
*/
export function applyCommentCountDelta(messages: MessageDto[], postId: number): MessageDto[] {
  return messages.map((message) =>
    message.id === postId && message.comments
      ? { ...message, comments: { ...message.comments, count: message.comments.count + 1 } }
      : message,
  );
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
Replaces one message's view count. View updates carry no full message either,
so the message is found by `chatId`/`messageId` and left untouched when it is
not loaded.
*/
export function applyViewsUpdate(messages: MessageDto[], chatId: PeerId, messageId: number, views: number): MessageDto[] {
  return messages.map((message) => (message.chatId === chatId && message.id === messageId ? { ...message, views } : message));
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

/**
The poll a `poll` update points at: the chat and message when Telegram named
them, plus the poll id, which is what a short update leaves to match on.
*/
export interface PollUpdateTarget {
  chatId: PeerId | null;
  messageId: number | null;
  pollId: string;
}

/**
The loaded message a poll update belongs to, or null when the poll is not on
screen. The named ids win (they are authoritative when present); the poll id
catches the short updates that name neither.
*/
export function findPollMessage(messages: readonly MessageDto[], target: PollUpdateTarget): MessageDto | null {
  if (target.chatId !== null && target.messageId !== null) {
    const named = messages.find((message) => message.chatId === target.chatId && message.id === target.messageId);
    if (named?.poll) return named;
  }
  return messages.find((message) => message.poll?.id === target.pollId) ?? null;
}

/**
Replaces one loaded message's poll. Poll updates carry no full message (they
are how Telegram reports a vote or a close), so the message is found by the
update's target and left untouched when it is not loaded.
*/
export function applyPollUpdate(messages: MessageDto[], target: PollUpdateTarget, poll: MessagePollDto): MessageDto[] {
  const matched = findPollMessage(messages, target);
  if (!matched) return messages;
  return messages.map((message) => (message === matched ? { ...message, poll } : message));
}

/**
Folds a poll update into the open thread. A poll update names a chat only
sometimes, so the poll itself decides which loaded message it belongs to; the
message then decides whether that is the thread on screen.
*/
export function updateThreadPoll(thread: ChatThread | null, target: PollUpdateTarget, poll: MessagePollDto): ChatThread | null {
  if (!thread) return thread;
  const matched = findPollMessage(thread.messages, target);
  if (!matched) return thread;
  return updateThread(thread, matched.chatId, (messages) => applyPollUpdate(messages, target, poll));
}
