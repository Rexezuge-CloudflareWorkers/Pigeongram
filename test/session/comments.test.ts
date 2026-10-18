import { getMarkedPeerId, Long, Message, PeersIndex } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { normalizeReplies, readComments, requireCommentPost, resolveDiscussion } from '../../worker/src/session/comments';
import { dispatchRpc } from '../../worker/src/session/rpc';
import type { GetCommentsResult } from '../../worker/src/rpc-types';

/**
 * The comments path against a fake `TelegramClient`: no network, but the same
 * high-level objects mtcute builds, so the raw TL parsing (`normalizeReplies`)
 * and the send routing are exercised for real.
 */

const CHANNEL_ID = getMarkedPeerId(20, 'channel');
const GROUP_ID = getMarkedPeerId(30, 'channel');

const rawUser = {
  _: 'user',
  id: 1,
  firstName: 'Ada',
  lastName: 'Lovelace',
  username: 'ada',
} as unknown as tl.RawUser;

const rawChannel = {
  _: 'channel',
  id: 20,
  title: 'Announcements',
  username: 'announce',
  broadcast: true,
  megagroup: false,
  date: 1_700_000_000,
  accessHash: Long.fromNumber(20_000),
} as unknown as tl.RawChannel;

const rawGroup = {
  ...rawChannel,
  id: 30,
  title: 'Announcements Chat',
  username: undefined,
  broadcast: false,
  megagroup: true,
  accessHash: Long.fromNumber(30_000),
} as unknown as tl.RawChannel;

function rawMessage(id: number, date = 1_700_000_000, extra: Record<string, unknown> = {}): tl.RawMessage {
  return {
    _: 'message',
    id,
    peerId: { _: 'peerChannel', channelId: 30 },
    fromId: { _: 'peerUser', userId: 1 },
    date,
    message: `comment ${id}`,
    out: false,
    ...extra,
  } as unknown as tl.RawMessage;
}

function chatPost(extra: Record<string, unknown> = {}): Message {
  return new Message(
    rawMessage(7, 1_700_000_000, {
      peerId: { _: 'peerChannel', channelId: 20 },
      fromId: null,
      message: 'news',
      ...extra,
    }),
    PeersIndex.from({ users: [rawUser], chats: [rawChannel, rawGroup] }),
  );
}

const commentsHeader = {
  _: 'messageReplies',
  comments: true,
  replies: 3,
  channelId: 30,
  maxId: 12,
  readMaxId: 11,
  recentRepliers: [],
};

/**
A `messages.channelMessages` answer; `count` defaults to the message count,
matching a window that is the whole thread.
*/
function repliesContainer(messages: tl.TypeMessage[], count?: number): tl.messages.RawChannelMessages {
  return {
    _: 'messages.channelMessages',
    count: count ?? messages.length,
    messages,
    topics: [],
    chats: [rawGroup],
    users: [rawUser],
  } as unknown as tl.messages.RawChannelMessages;
}

function discussion(rootId: number | null): tl.messages.RawDiscussionMessage {
  return {
    _: 'messages.discussionMessage',
    messages: rootId === null ? [{ _: 'messageEmpty', id: 0 }] : [rawMessage(rootId)],
    maxId: rootId ?? undefined,
    unreadCount: 0,
    chats: [rawGroup],
    users: [rawUser],
  } as unknown as tl.messages.RawDiscussionMessage;
}

interface FakeClient {
  client: TelegramClient;
  calls: Array<{ _: string } & Record<string, unknown>>;
  sent: Array<{ peer: tl.TypeInputPeer; text: string; replyTo?: number }>;
  commented: Array<{ postId: number; text: string }>;
}

function fakeClient(options: {
  discussionResult?: tl.messages.RawDiscussionMessage;
  discussionError?: Error;
  page?: tl.messages.TypeMessages;
  post?: Message | null;
}): FakeClient {
  const calls: Array<{ _: string } & Record<string, unknown>> = [];
  const sent: FakeClient['sent'] = [];
  const commented: FakeClient['commented'] = [];
  const client = {
    resolvePeer: async () => ({ _: 'inputPeerChannel', channelId: 20, accessHash: Long.fromNumber(20_000) }),
    call: async (request: { _: string } & Record<string, unknown>) => {
      calls.push(request);
      if (request._ === 'messages.getDiscussionMessage') {
        if (options.discussionError) throw options.discussionError;
        return options.discussionResult ?? discussion(10);
      }
      if (request._ === 'messages.getReplies') return options.page ?? repliesContainer([], 0);
      throw new Error(`unexpected call ${request._}`);
    },
    getMessages: async () => [options.post === undefined ? chatPost({ replies: commentsHeader }) : options.post],
    commentText: async (post: Message, text: string) => {
      commented.push({ postId: post.id, text });
      return chatPost({ id: 99 });
    },
    sendText: async (peer: tl.TypeInputPeer, text: string, params: { replyTo?: number } = {}) => {
      sent.push({ peer, text, ...(params.replyTo !== undefined && { replyTo: params.replyTo }) });
      return chatPost({ id: 98 });
    },
  } as unknown as TelegramClient;
  return { client, calls, sent, commented };
}

describe('normalizeReplies', () => {
  it('drops the thread root and orders the window oldest first', () => {
    const page = normalizeReplies(repliesContainer([rawMessage(12), rawMessage(2), rawMessage(10)]), 10, 50);
    expect(page.comments.map((message) => message.id)).toEqual([2, 12]);
  });

  it('reports the container count and points the cursor at the oldest comment', () => {
    const page = normalizeReplies(repliesContainer([rawMessage(12, 1_700_000_120), rawMessage(11, 1_700_000_110)], 50), 10, 2);
    expect(page.count).toBe(50);
    expect(page.nextOffset).toEqual({ id: 11, date: 1_700_000_110 });
  });

  it('still returns a cursor when a full page is also the whole thread count', () => {
    const page = normalizeReplies(repliesContainer([rawMessage(3), rawMessage(2)], 2), 10, 2);
    expect(page.nextOffset).toEqual({ id: 2, date: 1_700_000_000 });
  });

  it('returns no cursor once the thread start is loaded', () => {
    const page = normalizeReplies(repliesContainer([rawMessage(12), rawMessage(11)], 2), 10, 50);
    expect(page.nextOffset).toBeNull();
  });

  it('reads a not-modified answer as an empty window with the count', () => {
    const page = normalizeReplies({ _: 'messages.messagesNotModified', count: 7 } as tl.messages.RawMessagesNotModified, 10, 50);
    expect(page).toEqual({ comments: [], count: 7, nextOffset: null });
  });

  it('falls back to the loaded length when the answer carries no count', () => {
    const page = normalizeReplies(
      {
        _: 'messages.messages',
        messages: [rawMessage(11, 1_700_000_000, { replies: commentsHeader })],
        topics: [],
        chats: [rawChannel],
        users: [rawUser],
      } as unknown as tl.messages.RawMessages,
      10,
      50,
    );
    expect(page.count).toBe(1);
  });
});

describe('resolveDiscussion', () => {
  it('resolves the linked group and its root message', async () => {
    const { client } = fakeClient({ discussionResult: discussion(10) });
    await expect(resolveDiscussion(client, CHANNEL_ID, 7)).resolves.toEqual({
      peer: { _: 'inputPeerChannel', channelId: 30, accessHash: Long.fromNumber(30_000) },
      chatId: GROUP_ID,
      rootId: 10,
    });
  });

  it('treats a post without a thread as no discussion', async () => {
    const { client } = fakeClient({ discussionResult: discussion(null) });
    await expect(resolveDiscussion(client, CHANNEL_ID, 7)).resolves.toBeNull();
  });

  it('reads the pre-thread FLOOD_WAIT Telegram documents as no discussion', async () => {
    // `messages.getDiscussionMessage` rejects while Telegram is still creating
    // the discussion message; that is "no thread yet", not a failed read.
    const error = Object.assign(new Error('FLOOD_WAIT_2'), { text: 'FLOOD_WAIT_%d', seconds: 2 });
    const { client } = fakeClient({ discussionError: error });
    await expect(resolveDiscussion(client, CHANNEL_ID, 7)).resolves.toBeNull();
  });

  it('rethrows other RPC failures', async () => {
    const error = Object.assign(new Error('CHANNEL_PRIVATE'), { text: 'CHANNEL_PRIVATE' });
    const { client } = fakeClient({ discussionError: error });
    await expect(resolveDiscussion(client, CHANNEL_ID, 7)).rejects.toThrow('CHANNEL_PRIVATE');
  });
});

describe('readComments', () => {
  it('pages the thread with the root id and the caller offsets', async () => {
    const { client, calls } = fakeClient({ page: repliesContainer([rawMessage(12), rawMessage(11)], 50) });
    const result = await readComments(client, {
      chatId: CHANNEL_ID,
      messageId: 7,
      limit: 50,
      offsetId: 20,
      offsetDate: 1_700_000_000,
    });
    expect(result.discussion?.rootId).toBe(10);
    expect(result.page.comments.map((message) => message.id)).toEqual([11, 12]);
    expect(calls).toMatchObject([
      { _: 'messages.getDiscussionMessage', msgId: 7 },
      {
        _: 'messages.getReplies',
        msgId: 10,
        offsetId: 20,
        offsetDate: 1_700_000_000,
        limit: 50,
        addOffset: 0,
      },
    ]);
  });

  it('skips the thread read when no discussion exists', async () => {
    const { client, calls } = fakeClient({ discussionResult: discussion(null) });
    const result = await readComments(client, { chatId: CHANNEL_ID, messageId: 7, limit: 50 });
    expect(result.discussion).toBeNull();
    expect(result.page).toEqual({ comments: [], count: 0, nextOffset: null });
    expect(calls.map((call) => call._)).toEqual(['messages.getDiscussionMessage']);
  });
});

describe('requireCommentPost', () => {
  it('returns the post when it carries a comments section', async () => {
    const { client } = fakeClient({ post: chatPost({ replies: commentsHeader }) });
    await expect(requireCommentPost(client, CHANNEL_ID, 7)).resolves.toMatchObject({ id: 7 });
  });

  it('rejects posts without a comments section', async () => {
    const { client } = fakeClient({ post: chatPost() });
    await expect(requireCommentPost(client, CHANNEL_ID, 7)).rejects.toThrow('comments section');
  });

  it('rejects when the post is not found', async () => {
    const { client } = fakeClient({ post: null });
    await expect(requireCommentPost(client, CHANNEL_ID, 7)).rejects.toThrow('comments section');
  });
});

describe('dispatchRpc comments methods', () => {
  it('sends a top-level comment through the channel, letting mtcute mirror it', async () => {
    const { client, commented, calls } = fakeClient({});
    const result = (await dispatchRpc(client, 'sendComment', { chatId: CHANNEL_ID, messageId: 7, text: 'hi' })) as {
      message: { id: number };
    };
    expect(commented).toEqual([{ postId: 7, text: 'hi' }]);
    expect(result.message.id).toBe(99);
    expect(calls).toEqual([]);
  });

  it('sends a reply to a comment into the linked group', async () => {
    const { client, sent, commented } = fakeClient({});
    await dispatchRpc(client, 'sendComment', { chatId: CHANNEL_ID, messageId: 7, text: 'hey', replyTo: 5 });
    expect(commented).toEqual([]);
    expect(sent).toEqual([
      {
        peer: { _: 'inputPeerChannel', channelId: 30, accessHash: Long.fromNumber(30_000) },
        text: 'hey',
        replyTo: 5,
      },
    ]);
  });

  it('refuses to comment on a post without a comments section', async () => {
    const { client } = fakeClient({ post: chatPost() });
    await expect(dispatchRpc(client, 'sendComment', { chatId: CHANNEL_ID, messageId: 7, text: 'hi' })).rejects.toThrow('comments section');
  });

  it('validates the comment text', async () => {
    const { client } = fakeClient({});
    await expect(dispatchRpc(client, 'sendComment', { chatId: CHANNEL_ID, messageId: 7, text: '  ' })).rejects.toThrow(
      'text must be a non-empty string',
    );
  });

  it('answers getComments with the window, the count and the thread coordinates', async () => {
    const { client } = fakeClient({ page: repliesContainer([rawMessage(12), rawMessage(11)], 50) });
    const result = (await dispatchRpc(client, 'getComments', { chatId: CHANNEL_ID, messageId: 7 })) as GetCommentsResult;
    expect(result.comments.map((message) => message.id)).toEqual([11, 12]);
    expect(result.count).toBe(50);
    expect(result.discussionChatId).toBe(GROUP_ID);
    expect(result.discussionMessageId).toBe(10);
    expect(result.nextOffsetId).toBe(11);
    expect(result.nextOffsetDate).toBe(1_700_000_000);
  });

  it('answers getComments with null coordinates while no thread exists', async () => {
    const { client } = fakeClient({ discussionResult: discussion(null) });
    const result = (await dispatchRpc(client, 'getComments', { chatId: CHANNEL_ID, messageId: 7 })) as GetCommentsResult;
    expect(result).toMatchObject({
      comments: [],
      count: 0,
      discussionChatId: null,
      discussionMessageId: null,
    });
  });
});
