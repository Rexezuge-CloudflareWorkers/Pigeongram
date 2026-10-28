import type { ChatDto } from './types';

/**
 * The rules of a thread's first window: how much of the chat it reads, and
 * which chats carry a slash-command menu.
 *
 * Kept away from the thread controller because the window is worth reading on
 * its own. The opening window is deliberately small so a chat paints sooner;
 * older history is read at the paging size when the reader asks for it.
 */

export interface OpenThreadOptions {
  /**
  A linked post to land on: the first window is read around this message id
  instead of the newest messages, and the view scrolls to it.
  */
  postId?: number;
}

/**
How many messages the first open reads. A small window paints faster and the
cache makes a reopen instant; `PAGE_LIMIT` is the size every later page reads.
*/
export const OPEN_LIMIT = 20;

/**
How many messages one paging read asks for: the older page, the newer page and
the jump to the newest messages.
*/
export const PAGE_LIMIT = 50;

/**
How many already-read messages the unread window reads above the divider. The
rest of the opening page reaches towards the newer messages: with an opening
page of twenty, a chat opens with about fifteen read messages of context and
five unread ones. Telegram's `addOffset` is counted from the watermark and the
bridge clamps it to `-50`, so the context has to leave that much of the page on
the unread side.
*/
export const UNREAD_CONTEXT = 15;

/**
A history window's place in the chat: the id to start from and how many
messages to skip towards newer (negative) or older (positive) ones.
*/
export interface HistoryWindow {
  offsetId: number;
  addOffset: number;
}

/**
The window a normal open reads when the chat has unread messages: it starts a
little above the read watermark, so the first unread message and its divider
are in the page even when the backlog is larger than one window.

Null when there is no watermark to anchor on: offset `0` is the newest message,
so a never-read chat keeps the newest-window read.
*/
export function unreadWindow(readInboxMaxId: number): HistoryWindow | null {
  if (readInboxMaxId <= 0) return null;
  return { offsetId: readInboxMaxId, addOffset: UNREAD_CONTEXT - OPEN_LIMIT };
}

/**
The page after the contiguous loaded window: it starts at the window's newest
message and reads towards the newer ones, so the gap between an unread window
and the chat's newest message can be filled in order.
*/
export function newerWindow(windowEndId: number): HistoryWindow {
  return { offsetId: windowEndId, addOffset: -PAGE_LIMIT };
}

/**
Whether a chat carries a slash-command menu.

Telegram keeps bot commands outside the dialog peer, so they arrive through
their own read when a bot, group or supergroup opens.
*/
export function supportsCommands(kind: ChatDto['kind']): boolean {
  return kind === 'bot' || kind === 'group' || kind === 'supergroup';
}
