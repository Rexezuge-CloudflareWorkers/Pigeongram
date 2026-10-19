import { fetchHistory } from './api';
import type { MessageDto, PeerId } from './types';

/**
 * Where a thread opens: the newest messages, or a window around a linked post.
 *
 * Kept away from the thread controller because the two requests a jump may
 * make — and the rule for falling back between them — are the part of opening
 * worth reading on their own. The window size matches the controller's paging
 * so `loadOlder` continues from the same edge.
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
const JUMP_CONTEXT = 25;

const WINDOW_LIMIT = 50;

/**
Reads a chat's first window: the newest messages, or a window around a linked
post with newer context on one side and older history on the other.

A window that came back without the post — a deleted post, or one past the end
of the history — falls back to the page that ends at the post, which still
lands the view right next to it.
*/
export async function fetchOpenWindow(chatId: PeerId, postId: number | null): Promise<MessageDto[]> {
  if (postId === null) {
    const newest = await fetchHistory(chatId, { limit: WINDOW_LIMIT });
    return newest.messages;
  }
  const around = await fetchHistory(chatId, { limit: WINDOW_LIMIT, offsetId: postId, addOffset: -JUMP_CONTEXT });
  if (around.messages.some((message) => message.id === postId)) return around.messages;
  const ending = await fetchHistory(chatId, { limit: WINDOW_LIMIT, offsetId: postId + 1 });
  return ending.messages;
}
