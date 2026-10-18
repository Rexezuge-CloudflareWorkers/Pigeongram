import { getMarkedPeerId, Long, Message, PeersIndex } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { EngineError } from './errors';
import { rpcErrorText } from './rpc-errors';

/**
 * Channel-post comments.
 *
 * Announcement channels keep the replies to a post in the channel's linked
 * discussion group: the post is mirrored as a root message there and every
 * comment replies into that thread. mtcute only exposes the dialogue
 * (`getDiscussionMessage`) and the send side (`commentText`), so the thread
 * itself is read through the raw `messages.getReplies` call — the same shape
 * mtcute's own `getHistory` parses.
 */

export interface Discussion {
  /**
   * Input peer of the linked discussion group.
   */
  peer: tl.TypeInputPeer;
  /**
   * Marked id of the linked discussion group.
   */
  chatId: number;
  /**
   * Id of the thread's root message in the group.
   */
  rootId: number;
}

/**
 * Resolves the discussion thread a channel post's comments live in.
 *
 * Returns null when the thread does not exist yet (a post whose comments
 * section was never used has no root message). Telegram can reject the lookup
 * with `FLOOD_WAIT` while the discussion message is being created; that is the
 * documented "not yet created" answer, so it is read as null too.
 */
export async function resolveDiscussion(client: TelegramClient, chatId: number, messageId: number): Promise<Discussion | null> {
  const peer = await client.resolvePeer(chatId);
  let res: tl.messages.TypeDiscussionMessage;
  try {
    res = await client.call({ _: 'messages.getDiscussionMessage', peer, msgId: messageId });
  } catch (error) {
    if (rpcErrorText(error) === 'FLOOD_WAIT_%d') return null;
    throw error;
  }

  const root = res.messages[0];
  if (!root || root._ === 'messageEmpty') return null;
  const peerId = root.peerId;
  if (peerId._ !== 'peerChannel') return null;
  const group = res.chats.find((chat): chat is tl.RawChannel => chat._ === 'channel' && chat.id === peerId.channelId);
  if (!group || group.accessHash === undefined) return null;

  return {
    peer: { _: 'inputPeerChannel', channelId: group.id, accessHash: group.accessHash },
    chatId: getMarkedPeerId({ _: 'peerChannel', channelId: group.id }),
    rootId: root.id,
  };
}

/**
 * Like `resolveDiscussion`, but for operations that need a thread that
 * already exists (replying to a comment, which implies one).
 */
export async function requireDiscussion(client: TelegramClient, chatId: number, messageId: number): Promise<Discussion> {
  const discussion = await resolveDiscussion(client, chatId, messageId);
  if (!discussion) throw new EngineError('This post does not have a comment thread yet', 404);
  return discussion;
}

/**
 * Fetches and validates the post being commented on. Telegram only allows
 * comments when the post carries the `comments` flag, and the SPA can only
 * show the button for such posts, but the bridge never trusts the caller.
 */
export async function requireCommentPost(client: TelegramClient, chatId: number, messageId: number): Promise<Message> {
  const [post] = await client.getMessages(chatId, [messageId]);
  if (!post || !post.replies?.hasComments) {
    throw new EngineError('This post does not have a comments section', 400);
  }
  return post;
}

export interface CommentPage {
  /**
   * One window of the thread, oldest first.
   */
  comments: Message[];
  /**
   * Total number of comments in the thread.
   */
  count: number;
  /**
   * Cursor for the next (older) page, or null when the thread start is loaded.
   */
  nextOffset: { id: number; date: number } | null;
}

export interface ReadCommentsParams {
  chatId: number;
  messageId: number;
  limit: number;
  offsetId?: number;
  offsetDate?: number;
}

/**
 * Reads one window of a post's comments, newest window first: `offsetId` is
 * the oldest loaded comment and pages backwards through the thread.
 */
export async function readComments(
  client: TelegramClient,
  params: ReadCommentsParams,
): Promise<{ discussion: Discussion | null; page: CommentPage }> {
  const discussion = await resolveDiscussion(client, params.chatId, params.messageId);
  if (!discussion) return { discussion: null, page: { comments: [], count: 0, nextOffset: null } };

  const res = await client.call({
    _: 'messages.getReplies',
    peer: discussion.peer,
    msgId: discussion.rootId,
    offsetId: params.offsetId ?? 0,
    offsetDate: params.offsetDate ?? 0,
    addOffset: 0,
    limit: params.limit,
    maxId: 0,
    minId: 0,
    hash: Long.ZERO,
  });
  return { discussion, page: normalizeReplies(res, discussion.rootId, params.limit) };
}

/**
 * Normalizes a raw `messages.getReplies` answer: the thread root is dropped
 * (Telegram can include it as the first message) and the window is re-ordered
 * oldest first, matching `getHistory`'s contract. The cursor is the oldest
 * comment of a page that may still have older ones behind it.
 */
export function normalizeReplies(res: tl.messages.TypeMessages, rootId: number, limit: number): CommentPage {
  if (res._ === 'messages.messagesNotModified') {
    return { comments: [], count: res.count, nextOffset: null };
  }

  const peers = PeersIndex.from(res);
  const comments = res.messages
    .filter((message) => message._ !== 'messageEmpty')
    .map((message) => new Message(message, peers))
    .filter((message) => message.id !== rootId)
    .sort((a, b) => a.id - b.id);

  const count = 'count' in res ? res.count : comments.length;
  const oldest = comments[0];
  const hasOlder = oldest !== undefined && (comments.length >= limit || count > comments.length);
  return {
    comments,
    count,
    nextOffset: hasOlder ? { id: oldest.id, date: oldest.raw.date } : null,
  };
}
