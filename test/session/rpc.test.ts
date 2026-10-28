import { Long, Message, PeersIndex, Poll, User } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it, vi } from 'vitest';
import { rpc } from './rpc-dispatch';

const peers = PeersIndex.from({
  users: [
    {
      _: 'user',
      id: 1,
      self: false,
      contact: false,
      mutualContact: false,
      deleted: false,
      bot: false,
      botChatHistory: false,
      botNochats: false,
      verified: false,
      restricted: false,
      min: false,
      firstName: 'Ada',
    } as unknown as tl.RawUser,
  ],
  chats: [],
});

const rawUser = {
  _: 'user',
  id: 1,
  self: false,
  contact: false,
  mutualContact: false,
  deleted: false,
  bot: false,
  botChatHistory: false,
  botNochats: false,
  verified: false,
  restricted: false,
  min: false,
  firstName: 'Ada',
  lastName: 'Lovelace',
  username: 'ada',
} as unknown as tl.RawUser;

const rawBot = { ...rawUser, id: 5, bot: true, firstName: 'Helper', username: 'helper_bot' } as unknown as tl.RawUser;

function message(id: number, groupedId?: number): Message {
  return new Message(
    {
      _: 'message',
      id,
      peerId: { _: 'peerUser', userId: 1 },
      fromId: { _: 'peerUser', userId: 1 },
      date: 1_700_000_000,
      message: `m${id}`,
      out: false,
      ...(groupedId !== undefined && { groupedId: Long.fromNumber(groupedId) }),
    } as unknown as tl.RawMessage,
    peers,
  );
}

/**
A fake client whose `getHistory` answers from a script of pages, so the
oldest-edge completion can be observed call by call. `getMessages` answers the
reply-preview reads from `originals`.
*/
function fakeHistoryClient(
  pages: readonly (readonly Message[])[],
  originals: readonly Message[] = [],
): {
  client: TelegramClient;
  calls: Array<{ chatId: number; params: unknown }>;
  previews: Array<{ chatId: number; ids: number[] }>;
} {
  const calls: Array<{ chatId: number; params: unknown }> = [];
  const previews: Array<{ chatId: number; ids: number[] }> = [];
  const client = {
    getHistory: async (chatId: number, params?: unknown) => {
      calls.push({ chatId, params });
      return pages[calls.length - 1] ?? [];
    },
    getMessages: async (chatId: number, ids: number[]) => {
      previews.push({ chatId, ids });
      return ids.map((id) => originals.find((original) => original.id === id) ?? null);
    },
  } as unknown as TelegramClient;
  return { client, calls, previews };
}

function replyMessage(id: number, replyTo: number): Message {
  return new Message(
    {
      _: 'message',
      id,
      peerId: { _: 'peerUser', userId: 1 },
      fromId: { _: 'peerUser', userId: 1 },
      date: 1_700_000_000,
      message: `m${id}`,
      out: false,
      replyTo: { _: 'messageReplyHeader', replyToMsgId: replyTo },
    } as unknown as tl.RawMessage,
    peers,
  );
}

/**
 * The read path against a fake `TelegramClient`: what the SPA depends on is
 * that a scroll watermark travels through untouched, and that omitting one
 * stays a full read.
 */

function fakeClient(): { client: TelegramClient; reads: Array<{ chatId: number; maxId?: number }> } {
  const reads: Array<{ chatId: number; maxId?: number }> = [];
  const client = {
    readHistory: async (chatId: number, params?: { maxId?: number }) => {
      reads.push({ chatId, ...(params?.maxId !== undefined && { maxId: params.maxId }) });
    },
  } as unknown as TelegramClient;
  return { client, reads };
}

/**
A poll fixture: one answer, with results only when Telegram shared them.
*/
function poll(results?: tl.RawPollResults): Poll {
  return new Poll(
    {
      _: 'poll',
      id: Long.fromNumber(1_234_567_890),
      question: { _: 'textWithEntities', text: 'Tea or coffee?', entities: [] },
      answers: [{ _: 'pollAnswer', text: { _: 'textWithEntities', text: 'Tea', entities: [] }, option: new Uint8Array([1]) }],
    } as unknown as tl.TypePoll,
    peers,
    results,
  );
}

describe('getDialogs dispatch', () => {
  function fakeDialogsClient(options: { statuses?: unknown[]; fails?: boolean } = {}): {
    client: TelegramClient;
    calls: string[];
    reads: unknown[];
  } {
    const calls: string[] = [];
    const reads: unknown[] = [];
    const client = {
      iterDialogs: async function* (params?: unknown) {
        reads.push(params);
        yield { peer: new User(rawUser) };
        yield { peer: new User(rawBot) };
      },
      call: async (request: { _: string }) => {
        calls.push(request._);
        if (options.fails) throw new Error('METHOD_NOT_AVAILABLE');
        return options.statuses ?? [];
      },
    } as unknown as TelegramClient;
    return { client, calls, reads };
  }

  it('overlays the contact presences onto the people in the list', async () => {
    const { client, calls } = fakeDialogsClient({
      statuses: [{ _: 'contactStatus', userId: 1, status: { _: 'userStatusOnline', expires: 0 } }],
    });

    const result = (await rpc(client, 'getDialogs', {})) as { dialogs: Array<{ chat: { presence: unknown } }> };

    expect(calls).toEqual(['contacts.getStatuses']);
    expect(result.dialogs[0].chat.presence).toEqual({ status: 'online', lastSeenAt: null });
    expect(result.dialogs[1].chat.presence).toBeNull();
  });

  it('keeps the chat list when the contact statuses are unavailable', async () => {
    const { client } = fakeDialogsClient({ fails: true });

    const result = (await rpc(client, 'getDialogs', {})) as { dialogs: Array<{ chat: { presence: unknown } }> };

    expect(result.dialogs).toHaveLength(2);
    expect(result.dialogs[0].chat.presence).toBeNull();
  });

  it('reads the chat list, not the archive, by default', async () => {
    const { client, reads } = fakeDialogsClient();

    await rpc(client, 'getDialogs', { limit: 10 });

    expect(reads[0]).toEqual({ limit: 10, archived: 'exclude' });
  });

  it('reads the archive on its own', async () => {
    const { client, reads } = fakeDialogsClient();

    await rpc(client, 'getDialogs', { archived: true });

    expect(reads[0]).toEqual({ limit: 100, archived: 'only' });
  });

  it('rejects a flag that is not a boolean', async () => {
    const { client, reads } = fakeDialogsClient();

    await expect(rpc(client, 'getDialogs', { archived: 'yes' })).rejects.toThrow('archived must be a boolean');
    expect(reads).toEqual([]);
  });
});

describe('setArchived dispatch', () => {
  function fakeArchiveClient(): { client: TelegramClient; calls: unknown[] } {
    const calls: unknown[] = [];
    const client = {
      resolvePeer: async (chatId: number) => ({ _: 'inputPeerUser', userId: chatId, accessHash: 7 }),
      call: async (request: unknown) => {
        calls.push(request);
        return { _: 'updates', updates: [], users: [], chats: [], date: 0, seq: 0 };
      },
    } as unknown as TelegramClient;
    return { client, calls };
  }

  it('puts a chat into the archive', async () => {
    const { client, calls } = fakeArchiveClient();

    const result = (await rpc(client, 'setArchived', { chatId: 5, archived: true })) as { chatId: number; archived: boolean };

    expect(result).toEqual({ chatId: 5, archived: true });
    expect(calls).toEqual([
      {
        _: 'folders.editPeerFolders',
        folderPeers: [{ _: 'inputFolderPeer', peer: { _: 'inputPeerUser', userId: 5, accessHash: 7 }, folderId: 1 }],
      },
    ]);
  });

  it('brings a chat back out of the archive', async () => {
    const { client, calls } = fakeArchiveClient();

    await rpc(client, 'setArchived', { chatId: 5, archived: false });

    expect(calls[0]).toMatchObject({ folderPeers: [{ folderId: 0 }] });
  });

  it('rejects a chat that is not a marked peer id', async () => {
    const { client, calls } = fakeArchiveClient();

    await expect(rpc(client, 'setArchived', { chatId: 0, archived: true })).rejects.toThrow('marked Telegram peer id');
    expect(calls).toEqual([]);
  });

  it('rejects a flag that is not a boolean', async () => {
    const { client, calls } = fakeArchiveClient();

    await expect(rpc(client, 'setArchived', { chatId: 5, archived: 'yes' })).rejects.toThrow('archived must be a boolean');
    expect(calls).toEqual([]);
  });

  it('is not a method a batch may carry', async () => {
    const { client } = fakeArchiveClient();

    await expect(rpc(client, 'batch', { calls: [{ method: 'setArchived', params: { chatId: 5, archived: true } }] })).rejects.toThrow(
      'batchable read method',
    );
  });
});

describe('readHistory dispatch', () => {
  it('reads up to the given watermark', async () => {
    const { client, reads } = fakeClient();
    await rpc(client, 'readHistory', { chatId: 2, maxId: 12 });
    expect(reads).toEqual([{ chatId: 2, maxId: 12 }]);
  });

  it('reads the whole history when the watermark is omitted', async () => {
    const { client, reads } = fakeClient();
    await rpc(client, 'readHistory', { chatId: 2 });
    expect(reads).toEqual([{ chatId: 2 }]);
  });

  it('reads a zero watermark as the whole history', async () => {
    const { client, reads } = fakeClient();
    await rpc(client, 'readHistory', { chatId: 2, maxId: 0 });
    expect(reads).toEqual([{ chatId: 2 }]);
  });

  it('rejects a malformed watermark before Telegram is touched', async () => {
    const { client, reads } = fakeClient();
    await expect(rpc(client, 'readHistory', { chatId: 2, maxId: -1 })).rejects.toThrow('Expected a non-negative integer');
    expect(reads).toEqual([]);
  });
});

describe('getHistory dispatch', () => {
  it('returns the window oldest first', async () => {
    const { client, calls } = fakeHistoryClient([[message(12), message(11)]]);
    const result = (await rpc(client, 'getHistory', { chatId: 1 })) as { messages: Array<{ id: number }> };
    expect(result.messages.map((entry) => entry.id)).toEqual([11, 12]);
    expect(calls).toEqual([{ chatId: 1, params: { limit: 50 } }]);
  });

  it('resolves a reply whose original sits outside the window', async () => {
    const { client, previews } = fakeHistoryClient([[replyMessage(12, 5)]], [message(5)]);
    const result = (await rpc(client, 'getHistory', { chatId: 1 })) as {
      messages: Array<{ reply: { senderName: string | null; text: string; date: number | null } | null }>;
    };

    expect(previews).toEqual([{ chatId: 1, ids: [5] }]);
    expect(result.messages[0].reply).toMatchObject({
      senderName: 'Ada',
      date: 1_700_000_000_000,
      text: 'm5',
    });
  });

  it('completes the oldest album at the window edge', async () => {
    const { client, calls } = fakeHistoryClient([
      [message(13, 7), message(12, 7), message(11, 7)],
      [message(10, 7), message(9, 7)],
    ]);
    const result = (await rpc(client, 'getHistory', { chatId: 1, limit: 3 })) as { messages: Array<{ id: number }> };
    expect(result.messages.map((entry) => entry.id)).toEqual([9, 10, 11, 12, 13]);
    expect(calls[1]).toEqual({
      chatId: 1,
      params: { limit: 9, offset: { id: 11, date: 1_700_000_000 } },
    });
  });

  it('stops at the album boundary instead of swallowing older messages', async () => {
    const { client, calls } = fakeHistoryClient([
      [message(20, 9), message(19, 9)],
      [message(18, 8), message(17, 8)],
    ]);
    const result = (await rpc(client, 'getHistory', { chatId: 1, limit: 2 })) as { messages: Array<{ id: number }> };
    expect(result.messages.map((entry) => entry.id)).toEqual([19, 20]);
    expect(calls).toHaveLength(2);
  });

  it('skips the extra fetch when the oldest message is not grouped', async () => {
    const { client, calls } = fakeHistoryClient([[message(2), message(1)]]);
    await rpc(client, 'getHistory', { chatId: 1, limit: 2 });
    expect(calls).toHaveLength(1);
  });

  it('passes a link jump through: an id alone, skipped towards newer messages', async () => {
    const { client, calls } = fakeHistoryClient([[message(30), message(29)]]);
    await rpc(client, 'getHistory', { chatId: 1, limit: 50, offsetId: 1234, addOffset: -25 });
    expect(calls).toEqual([{ chatId: 1, params: { limit: 50, offset: { id: 1234, date: 0 }, addOffset: -25 } }]);
  });

  it('clamps a forward skip away, since the bridge has no forward paging', async () => {
    const { client, calls } = fakeHistoryClient([[message(2), message(1)]]);
    await rpc(client, 'getHistory', { chatId: 1, addOffset: 40 });
    expect(calls).toEqual([{ chatId: 1, params: { limit: 50 } }]);
  });

  it('reads around an anchored post, with the newer context beside it', async () => {
    const { client, calls } = fakeHistoryClient([[message(30), message(29)]]);
    const result = (await rpc(client, 'getHistory', { chatId: 1, anchorId: 30 })) as { messages: Array<{ id: number }> };

    expect(result.messages.map((entry) => entry.id)).toEqual([29, 30]);
    expect(calls).toEqual([{ chatId: 1, params: { limit: 50, offset: { id: 30, date: 0 }, addOffset: -25 } }]);
  });

  it('centres a small anchored window with half its page as newer context', async () => {
    const { client, calls } = fakeHistoryClient([[message(30), message(29)]]);
    await rpc(client, 'getHistory', { chatId: 1, limit: 20, anchorId: 30 });

    expect(calls).toEqual([{ chatId: 1, params: { limit: 20, offset: { id: 30, date: 0 }, addOffset: -10 } }]);
  });

  it('falls back to the page that ends at an anchor the window missed', async () => {
    const { client, calls } = fakeHistoryClient([[message(29)], [message(28), message(27)]]);
    const result = (await rpc(client, 'getHistory', { chatId: 1, anchorId: 30 })) as { messages: Array<{ id: number }> };

    expect(result.messages.map((entry) => entry.id)).toEqual([27, 28]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ chatId: 1, params: { limit: 50, offset: { id: 31, date: 0 } } });
  });
});

describe('forwardMessages dispatch', () => {
  function fakeForwardClient(): {
    client: TelegramClient;
    calls: Array<{ fromChatId: number; toChatId: number; messages: number[] }>;
  } {
    const calls: Array<{ fromChatId: number; toChatId: number; messages: number[] }> = [];
    const client = {
      forwardMessagesById: async (params: { fromChatId: number; toChatId: number; messages: number[] }) => {
        calls.push(params);
        return [message(31), message(32)];
      },
    } as unknown as TelegramClient;
    return { client, calls };
  }

  it('forwards the batch and returns the copies in the destination', async () => {
    const { client, calls } = fakeForwardClient();
    const result = (await rpc(client, 'forwardMessages', {
      chatId: 1,
      toChatId: 5,
      messageIds: [12, 13],
    })) as { messages: Array<{ id: number; text: string }> };

    expect(calls).toEqual([{ fromChatId: 1, toChatId: 5, messages: [12, 13] }]);
    expect(result.messages.map((entry) => entry.id)).toEqual([31, 32]);
  });

  it('rejects malformed message lists before Telegram is touched', async () => {
    const { client, calls } = fakeForwardClient();
    for (const messageIds of [[], [0], [1, 1], [1.5], Array.from({ length: 101 }, (_, index) => index + 1)]) {
      await expect(rpc(client, 'forwardMessages', { chatId: 1, toChatId: 5, messageIds })).rejects.toThrow('messageIds');
    }
    await expect(rpc(client, 'forwardMessages', { chatId: 1, messageIds: [1] })).rejects.toThrow('chatId');
    expect(calls).toEqual([]);
  });
});

/**
 * Voting: the bridge takes answer indexes, resolves them against the live
 * message so a stale list can never send another answer's bytes, and answers
 * with the poll Telegram returned.
 */
describe('sendVote dispatch', () => {
  function fakeVoteClient(): { client: TelegramClient; votes: Array<{ chatId: number; message: number; options: number[] | null }> } {
    const votes: Array<{ chatId: number; message: number; options: number[] | null }> = [];
    const client = {
      sendVote: async (params: { chatId: number; message: number; options: number[] | null }) => {
        votes.push(params);
        return poll({
          _: 'pollResults',
          totalVoters: 1,
          results: [{ _: 'pollAnswerVoters', option: new Uint8Array([1]), voters: 1, chosen: true }],
        });
      },
    } as unknown as TelegramClient;
    return { client, votes };
  }

  it('passes the selected answer indexes through and returns the new poll', async () => {
    const { client, votes } = fakeVoteClient();
    const result = (await rpc(client, 'sendVote', { chatId: 1, messageId: 7, options: [0] })) as {
      poll: { id: string; totalVoters: number | null; answers: unknown[] };
    };
    expect(votes).toEqual([{ chatId: 1, message: 7, options: [0] }]);
    expect(result.poll.id).toBe('1234567890');
    expect(result.poll.totalVoters).toBe(1);
    expect(result.poll.answers).toEqual([{ text: 'Tea', voters: 1, chosen: true, correct: null }]);
  });

  it('reads a missing selection as a retraction', async () => {
    const { client, votes } = fakeVoteClient();
    await rpc(client, 'sendVote', { chatId: 1, messageId: 7 });
    expect(votes).toEqual([{ chatId: 1, message: 7, options: null }]);
  });

  it('rejects malformed selections before Telegram is touched', async () => {
    const { client, votes } = fakeVoteClient();
    for (const options of [[], 'Tea', [1.5], [-1], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) {
      await expect(rpc(client, 'sendVote', { chatId: 1, messageId: 7, options })).rejects.toThrow('options');
    }
    expect(votes).toEqual([]);
  });
});

describe('getPollResults dispatch', () => {
  it('returns the poll as the DTO the SPA folds in', async () => {
    const calls: Array<{ chatId: number; message: number }> = [];
    const client = {
      getPollResults: async (params: { chatId: number; message: number }) => {
        calls.push(params);
        return poll();
      },
    } as unknown as TelegramClient;
    const result = (await rpc(client, 'getPollResults', { chatId: 1, messageId: 7 })) as {
      poll: { question: string; totalVoters: number | null };
    };
    expect(calls).toEqual([{ chatId: 1, message: 7 }]);
    expect(result.poll.question).toBe('Tea or coffee?');
    expect(result.poll.totalVoters).toBeNull();
  });
});

describe('getBotCommands dispatch', () => {
  it('returns the commands of a bot chat', async () => {
    const calls: number[] = [];
    const client = {
      getFullUser: async (chatId: number) => {
        calls.push(chatId);
        return { full: { botInfo: { description: 'Answers questions.', commands: [{ command: 'start', description: 'Start' }] } } };
      },
    } as unknown as TelegramClient;

    await expect(rpc(client, 'getBotCommands', { chatId: 5 })).resolves.toEqual({
      commands: [{ command: 'start', description: 'Start' }],
      description: 'Answers questions.',
    });
    expect(calls).toEqual([5]);
  });

  it('rejects a malformed chat id before Telegram is touched', async () => {
    const calls: unknown[] = [];
    const client = {
      getFullUser: async (chatId: number) => {
        calls.push(chatId);
        return { full: {} };
      },
    } as unknown as TelegramClient;

    await expect(rpc(client, 'getBotCommands', { chatId: 0 })).rejects.toThrow('chatId');
    expect(calls).toEqual([]);
  });
});

describe('getProfile dispatch', () => {
  it('returns the profile of a peer', async () => {
    const calls: number[] = [];
    const client = {
      getFullUser: async (chatId: number) => {
        calls.push(chatId);
        return {
          id: 1,
          isBot: false,
          displayName: 'Ada Lovelace',
          username: 'ada',
          bio: 'Mathematician.',
          full: {},
        };
      },
    } as unknown as TelegramClient;

    await expect(rpc(client, 'getProfile', { chatId: 1 })).resolves.toEqual({
      profile: {
        id: 1,
        kind: 'user',
        title: 'Ada Lovelace',
        username: 'ada',
        about: 'Mathematician.',
        photo: null,
        membersCount: null,
      },
    });
    expect(calls).toEqual([1]);
  });

  it('rejects a malformed chat id before Telegram is touched', async () => {
    const calls: unknown[] = [];
    const client = {
      getFullUser: async (chatId: number) => {
        calls.push(chatId);
        return { full: {} };
      },
    } as unknown as TelegramClient;

    await expect(rpc(client, 'getProfile', { chatId: 0 })).rejects.toThrow('chatId');
    expect(calls).toEqual([]);
  });

  it('is a method a batch may carry', async () => {
    const client = {
      getFullUser: async () => ({
        id: 1,
        isBot: false,
        displayName: 'Ada Lovelace',
        username: 'ada',
        bio: '',
        full: {},
      }),
    } as unknown as TelegramClient;

    const result = (await rpc(client, 'batch', {
      calls: [{ method: 'getProfile', params: { chatId: 1 } }],
    })) as { results: Array<{ ok: boolean; result?: unknown }> };

    expect(result.results[0]?.ok).toBe(true);
  });
});

describe('pressCallbackButton dispatch', () => {
  function fakeCallbackClient(answer: Record<string, unknown>): {
    client: TelegramClient;
    calls: Array<{ chatId: number; message: number; data: Uint8Array }>;
  } {
    const calls: Array<{ chatId: number; message: number; data: Uint8Array }> = [];
    const client = {
      getCallbackAnswer: async (params: { chatId: number; message: number; data: Uint8Array }) => {
        calls.push(params);
        return { _: 'messages.botCallbackAnswer', cacheTime: 0, ...answer };
      },
    } as unknown as TelegramClient;
    return { client, calls };
  }

  it('decodes the payload and returns the bot answer', async () => {
    const { client, calls } = fakeCallbackClient({ message: 'Done', alert: true, url: 'https://example.com/next' });
    await expect(rpc(client, 'pressCallbackButton', { chatId: 1, messageId: 7, data: 'AQID' })).resolves.toEqual({
      text: 'Done',
      alert: true,
      url: 'https://example.com/next',
    });
    expect(calls).toEqual([{ chatId: 1, message: 7, data: new Uint8Array([1, 2, 3]) }]);
  });

  it('maps a silent answer onto nulls and false', async () => {
    const { client } = fakeCallbackClient({});
    await expect(rpc(client, 'pressCallbackButton', { chatId: 1, messageId: 7, data: 'AQID' })).resolves.toEqual({
      text: null,
      alert: false,
      url: null,
    });
  });

  it('rejects malformed payloads before Telegram is touched', async () => {
    const { client, calls } = fakeCallbackClient({});
    for (const data of [undefined, '***', 'A'.repeat(88)]) {
      await expect(rpc(client, 'pressCallbackButton', { chatId: 1, messageId: 7, data })).rejects.toThrow('data');
    }
    expect(calls).toEqual([]);
  });
});

describe('sendMessage dispatch', () => {
  function fakeSendClient(): {
    client: TelegramClient;
    calls: Array<{ chatId: number; text: string; params: unknown }>;
  } {
    const calls: Array<{ chatId: number; text: string; params: unknown }> = [];
    const client = {
      sendText: async (chatId: number, text: string, params?: unknown) => {
        calls.push({ chatId, text, params });
        return message(40);
      },
    } as unknown as TelegramClient;
    return { client, calls };
  }

  it('forwards the client random id, so a retry cannot duplicate the message', async () => {
    const { client, calls } = fakeSendClient();
    await rpc(client, 'sendMessage', { chatId: 1, text: 'hi', randomId: '123456789' });

    expect(calls).toHaveLength(1);
    const params = calls[0].params as { randomId?: Long };
    expect(params.randomId?.toString()).toBe('123456789');
  });

  it('omits the random id when the client did not choose one', async () => {
    const { client, calls } = fakeSendClient();
    await rpc(client, 'sendMessage', { chatId: 1, text: 'hi' });

    expect(calls[0].params).toEqual({});
  });

  it('rejects a malformed random id before Telegram is touched', async () => {
    const { client, calls } = fakeSendClient();
    for (const randomId of ['', 'abc', '-1', '0', '1.5', 12, '9223372036854775808']) {
      await expect(rpc(client, 'sendMessage', { chatId: 1, text: 'hi', randomId })).rejects.toThrow('randomId');
    }
    expect(calls).toEqual([]);
  });
});

describe('batch dispatch', () => {
  /**
   * A fake client whose reads are answered one at a time, so a batch can be
   * observed to run its calls together.
   */
  function fakeBatchClient(): { client: TelegramClient; calls: string[] } {
    const calls: string[] = [];
    const client = {
      getMe: async () => {
        calls.push('getMe');
        return new User(rawUser);
      },
      iterDialogs: async function* () {
        calls.push('getDialogs');
        yield { peer: new User(rawUser) };
      },
      call: async (request: { _: string }) => {
        calls.push(request._);
        return [];
      },
    } as unknown as TelegramClient;
    return { client, calls };
  }

  it('answers every call in the order it was given', async () => {
    const { client } = fakeBatchClient();

    const result = (await rpc(client, 'batch', {
      calls: [{ method: 'getMe' }, { method: 'getDialogs', params: { limit: 10 } }],
    })) as { results: Array<{ ok: boolean; result?: unknown }> };

    expect(result.results).toHaveLength(2);
    expect(result.results[0].ok).toBe(true);
    expect(result.results[0].result).toEqual({ me: expect.objectContaining({ id: 1 }) });
    expect(result.results[1].ok).toBe(true);
  });

  it('keeps a failed call from taking the reads beside it down', async () => {
    const { client } = fakeBatchClient();

    const result = (await rpc(client, 'batch', {
      calls: [{ method: 'getHistory', params: { chatId: 0 } }, { method: 'getMe' }],
    })) as { results: Array<{ ok: boolean; error?: string }> };

    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error).toContain('chatId');
    expect(result.results[1].ok).toBe(true);
  });

  it('refuses a write, which has no defined order in a batch', async () => {
    const { client, calls } = fakeBatchClient();

    await expect(rpc(client, 'batch', { calls: [{ method: 'sendMessage', params: { chatId: 1, text: 'hi' } }] })).rejects.toThrow(
      'batchable read method',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a nested batch', async () => {
    const { client } = fakeBatchClient();

    await expect(rpc(client, 'batch', { calls: [{ method: 'batch' }] })).rejects.toThrow('batchable read method');
  });

  it('refuses an empty batch and one that is too long', async () => {
    const { client } = fakeBatchClient();

    await expect(rpc(client, 'batch', { calls: [] })).rejects.toThrow('at least one');
    const many = Array.from({ length: 9 }, () => ({ method: 'getMe' }));
    await expect(rpc(client, 'batch', { calls: many })).rejects.toThrow('at most 8');
  });
});

describe('sendReaction dispatch', () => {
  it('sends a unicode emoji and maps the answered message', async () => {
    const calls: unknown[] = [];
    const client = {
      sendReaction: async (input: unknown) => {
        calls.push(input);
        return message(5);
      },
    } as unknown as TelegramClient;

    const result = (await rpc(client, 'sendReaction', { chatId: 1, messageId: 5, emoji: '👍' })) as { message: { id: number } | null };

    expect(calls).toEqual([{ chatId: 1, message: 5, emoji: '👍' }]);
    expect(result.message?.id).toBe(5);
  });

  it('sends a custom emoji as a document id and accepts a removed reaction', async () => {
    const calls: unknown[] = [];
    const client = {
      sendReaction: async (input: unknown) => {
        calls.push(input);
        return null;
      },
    } as unknown as TelegramClient;

    const result = (await rpc(client, 'sendReaction', { chatId: 1, messageId: 5, customEmojiId: '123' })) as { message: unknown };

    expect(calls).toHaveLength(1);
    expect(String((calls[0] as { emoji: Long }).emoji)).toBe('123');
    expect(result.message).toBeNull();
    await expect(rpc(client, 'sendReaction', { chatId: 1, messageId: 5 })).resolves.toEqual({ message: null });
  });

  it('refuses both kinds at once and a malformed custom id', async () => {
    const client = { sendReaction: async () => message(5) } as unknown as TelegramClient;

    await expect(rpc(client, 'sendReaction', { chatId: 1, messageId: 5, emoji: '👍', customEmojiId: '123' })).rejects.toThrow('not both');
    await expect(rpc(client, 'sendReaction', { chatId: 1, messageId: 5, customEmojiId: 'abc' })).rejects.toThrow('decimal document id');
  });
});

describe('searchMessages dispatch', () => {
  it('carries the offset, the limit and the next cursor', async () => {
    const calls: unknown[] = [];
    const found = Object.assign([message(5)], { next: 4 });
    const client = {
      searchMessages: async (input: unknown) => {
        calls.push(input);
        return found;
      },
    } as unknown as TelegramClient;

    const result = (await rpc(client, 'searchMessages', { chatId: 1, query: 'ada', limit: 20, offsetId: 9 })) as {
      messages: Array<{ id: number }>;
      nextOffsetId: number;
    };

    expect(calls).toEqual([{ chatId: 1, query: 'ada', limit: 20, offset: 9 }]);
    expect(result.messages.map((entry) => entry.id)).toEqual([5]);
    expect(result.nextOffsetId).toBe(4);
  });

  it('omits an absent offset and clamps the limit', async () => {
    const calls: unknown[] = [];
    const client = {
      searchMessages: async (input: unknown) => {
        calls.push(input);
        return Object.assign([], { next: undefined });
      },
    } as unknown as TelegramClient;

    await rpc(client, 'searchMessages', { chatId: 1, query: 'ada', limit: 999 });
    expect(calls).toEqual([{ chatId: 1, query: 'ada', limit: 100 }]);
  });
});

describe('searchGlobal dispatch', () => {
  const globalPeers = PeersIndex.from({
    users: [rawUser, { ...rawUser, id: 2, firstName: 'Bob', username: 'bob' } as unknown as tl.RawUser],
    chats: [],
  });

  function globalMessage(id: number, userId: number): Message {
    return new Message(
      {
        _: 'message',
        id,
        peerId: { _: 'peerUser', userId },
        fromId: { _: 'peerUser', userId },
        date: 1_700_000_000,
        message: `m${id}`,
        out: false,
      } as unknown as tl.RawMessage,
      globalPeers,
    );
  }

  it('resolves the cursor, carries the page and answers its chats and next cursor', async () => {
    const calls: unknown[] = [];
    const found = Object.assign([globalMessage(5, 1), globalMessage(4, 2)], {
      next: { rate: 2, id: 3, peer: { _: 'inputPeerUser', userId: 2, accessHash: Long.ZERO } },
    });
    const resolved = { _: 'inputPeerUser', userId: 2, accessHash: Long.fromNumber(7) } as tl.TypeInputPeer;
    const resolvePeer = vi.fn(async () => resolved);
    const client = {
      resolvePeer,
      searchGlobal: async (input: unknown) => {
        calls.push(input);
        return found;
      },
    } as unknown as TelegramClient;

    const result = (await rpc(client, 'searchGlobal', {
      query: '#tag',
      limit: 20,
      offset: { rate: 1, chatId: 2, messageId: 9 },
    })) as {
      messages: Array<{ id: number }>;
      chats: Array<{ id: number }>;
      next: { rate: number; chatId: number; messageId: number };
    };

    expect(resolvePeer).toHaveBeenCalledWith(2);
    expect(calls).toEqual([{ query: '#tag', limit: 20, offset: { rate: 1, peer: resolved, id: 9 } }]);
    expect(result.messages.map((entry) => entry.id)).toEqual([5, 4]);
    expect(result.chats.map((chat) => chat.id)).toEqual([1, 2]);
    expect(result.next).toEqual({ rate: 2, chatId: 2, messageId: 3 });
  });

  it('omits an absent cursor and clamps the limit', async () => {
    const calls: unknown[] = [];
    const client = {
      searchGlobal: async (input: unknown) => {
        calls.push(input);
        return Object.assign([], { next: undefined });
      },
    } as unknown as TelegramClient;

    const result = (await rpc(client, 'searchGlobal', { query: 'ada', limit: 999 })) as {
      messages: unknown[];
      chats: unknown[];
      next?: unknown;
    };

    expect(calls).toEqual([{ query: 'ada', limit: 100 }]);
    expect(result.messages).toEqual([]);
    expect(result.chats).toEqual([]);
    expect(result.next).toBeUndefined();
  });

  it('rejects a partial or malformed cursor', async () => {
    const client = {
      resolvePeer: async () => ({ _: 'inputPeerEmpty' }),
      searchGlobal: async () => Object.assign([], { next: undefined }),
    } as unknown as TelegramClient;

    for (const offset of [
      42,
      { rate: 1 },
      { rate: -1, chatId: 2, messageId: 3 },
      { rate: 1, chatId: 0, messageId: 3 },
      { rate: 1, chatId: 2, messageId: 0 },
    ]) {
      await expect(rpc(client, 'searchGlobal', { query: 'ada', offset })).rejects.toMatchObject({ status: 400 });
    }
    await expect(rpc(client, 'searchGlobal', { query: '' })).rejects.toThrow('query must be a non-empty string');
  });
});
