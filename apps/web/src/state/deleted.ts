import { toDialogMessage } from '../dialog-message';
import { countUnreadGroupsBetween } from '../groups';
import type { ChatThread } from '../thread-state';
import type { CommentsThread } from './index';
import type { DialogDto, MessageDto, PeerId } from '../types';

/**
The folds a deletion applies, split from `state/index.ts` to keep that module
under the god-file cap.

A deletion is the only fold that takes something away: the chat list has to
give up a preview and a slice of its badge, and a comments thread has to give up
a comment and one of its reported count. Both are keyed by message id, so a
repeated fold — the tab that asked, then the engine's echo of the same delete —
lands on the same state.
*/

/**
What a deletion took out of the open thread, for the chat list's repair.

Only the thread can answer this: it holds the messages, so it knows whether the
chat's own last message or an unread one was among the ids. A deletion in
another chat, or one the window does not hold, has nothing to report.
*/
interface DeletionReport {
  chatId: PeerId;
  removed: MessageDto[];
  remaining: MessageDto[];
}

export function deletionReport(thread: ChatThread | null, chatId: PeerId | null, messageIds: readonly number[]): DeletionReport | null {
  if (!thread || (chatId !== null && chatId !== thread.chat.id)) return null;
  const ids = new Set(messageIds);
  const removed = thread.messages.filter((message) => ids.has(message.id));
  if (removed.length === 0) return null;
  return { chatId: thread.chat.id, removed, remaining: thread.messages.filter((message) => !ids.has(message.id)) };
}

/**
Folds deleted messages into the chat list.

`removed` and `remaining` are what the open window knew: the messages the
deletion took out, and the ones it left behind. They come from the thread's own
fold when the chat is open, which is the case that can repair the row in place —
the preview falls back to the newest message still loaded, and the badge gives
up the unread messages the deletion covered, an album counting once.

A deletion in a chat the thread is not showing arrives with ids alone: the
preview is cleared when it named a deleted message, and the badge waits for the
next read of the list, because the ids of a chat's incoming and outgoing
messages cannot be told apart without the messages themselves.
*/
export function applyDeletedMessages(
  dialogs: DialogDto[],
  chatId: PeerId,
  messageIds: readonly number[],
  removed: readonly MessageDto[] = [],
  remaining: readonly MessageDto[] = [],
): DialogDto[] {
  const ids = new Set(messageIds);
  for (const message of removed) ids.add(message.id);
  if (ids.size === 0) return dialogs;
  return dialogs.map((dialog) => {
    if (dialog.chat.id !== chatId) return dialog;
    const previewDeleted = dialog.lastMessage !== null && ids.has(dialog.lastMessage.id);
    const unreadCovered = countUnreadGroupsBetween(removed, dialog.readInboxMaxId, Infinity);
    if (!previewDeleted && unreadCovered === 0) return dialog;
    const newest = previewDeleted ? newestMessage(remaining) : undefined;
    return {
      ...dialog,
      lastMessage: newest === undefined ? dialog.lastMessage : newest === null ? null : toDialogMessage(newest),
      unread: Math.max(0, dialog.unread - unreadCovered),
    };
  });
}

/**
The newest of a set of messages, or null when the set is empty.
*/
function newestMessage(messages: readonly MessageDto[]): MessageDto | null {
  let newest: MessageDto | null = null;
  for (const message of messages) {
    if (!newest || message.id > newest.id) newest = message;
  }
  return newest;
}

/**
Folds deleted comments into the open thread: the loaded rows go, the reported
count drops by as many, and the entrance animation forgets the ids.

The older-pages cursor stays where it is: it names the oldest comment the window
holds, which deleting a newer one does not move.
*/
export function applyCommentDeleted(
  thread: CommentsThread | null,
  chatId: PeerId | null,
  messageIds: readonly number[],
): CommentsThread | null {
  if (!thread || messageIds.length === 0) return thread;
  if (chatId !== null && chatId !== thread.discussionChatId) return thread;
  const ids = new Set(messageIds);
  const comments = thread.comments.filter((comment) => !ids.has(comment.id));
  if (comments.length === thread.comments.length) return thread;
  const newMessageIds = new Set(thread.newMessageIds);
  for (const id of ids) newMessageIds.delete(id);
  return {
    ...thread,
    comments,
    count: Math.max(0, thread.count - (thread.comments.length - comments.length)),
    newMessageIds,
  };
}

/**
Puts comments a failed delete rolled back into the open thread. The socket may
have delivered one again in the meantime, and the merge keeps the newer copy of
each id, so the restore is idempotent.
*/
export function applyCommentRestored(thread: CommentsThread | null, messages: readonly MessageDto[]): CommentsThread | null {
  if (!thread || messages.length === 0) return thread;
  if (messages[0].chatId !== thread.discussionChatId) return thread;
  const missing = messages.filter((message) => thread.comments.every((loaded) => loaded.id !== message.id));
  if (missing.length === 0) return thread;
  return {
    ...thread,
    comments: [...thread.comments, ...missing].sort((left, right) => left.id - right.id),
    count: thread.count + missing.length,
  };
}
