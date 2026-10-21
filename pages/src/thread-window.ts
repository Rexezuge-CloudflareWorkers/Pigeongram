import type { ChatDto } from './types';

/**
 * The rules of a thread's first window: how much of the chat it reads, and
 * which chats carry a slash-command menu.
 *
 * Kept away from the thread controller because the window is worth reading on
 * its own. The size matches the controller's paging so `loadOlder` continues
 * from the same edge.
 */

export interface OpenThreadOptions {
  /**
  A linked post to land on: the first window is read around this message id
  instead of the newest messages, and the view scrolls to it.
  */
  postId?: number;
}

/**
How many messages of context the jump window reads on the newer side of a
linked post; the rest of the page is the post and its older messages.
*/
export const WINDOW_LIMIT = 50;

/**
Whether a chat carries a slash-command menu.

Telegram keeps bot commands outside the dialog peer, so they arrive through
their own read when a bot, group or supergroup opens.
*/
export function supportsCommands(kind: ChatDto['kind']): boolean {
  return kind === 'bot' || kind === 'group' || kind === 'supergroup';
}
