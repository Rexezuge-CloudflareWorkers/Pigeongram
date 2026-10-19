import { Long, Message, PeersIndex, Poll } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { dispatchRpc } from '../../worker/src/session/rpc';

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
oldest-edge completion can be observed call by call.
*/
function fakeHistoryClient(pages: readonly (readonly Message[])[]): {
  client: TelegramClient;
  calls: Array<{ chatId: number; params: unknown }>;
} {
  const calls: Array<{ chatId: number; params: unknown }> = [];
  const client = {
    getHistory: async (chatId: number, params?: unknown) => {
      calls.push({ chatId, params });
      return pages[calls.length - 1] ?? [];
    },
  } as unknown as TelegramClient;
  return { client, calls };
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

describe('readHistory dispatch', () => {
  it('reads up to the given watermark', async () => {
    const { client, reads } = fakeClient();
    await dispatchRpc(client, 'readHistory', { chatId: 2, maxId: 12 });
    expect(reads).toEqual([{ chatId: 2, maxId: 12 }]);
  });

  it('reads the whole history when the watermark is omitted', async () => {
    const { client, reads } = fakeClient();
    await dispatchRpc(client, 'readHistory', { chatId: 2 });
    expect(reads).toEqual([{ chatId: 2 }]);
  });

  it('reads a zero watermark as the whole history', async () => {
    const { client, reads } = fakeClient();
    await dispatchRpc(client, 'readHistory', { chatId: 2, maxId: 0 });
    expect(reads).toEqual([{ chatId: 2 }]);
  });

  it('rejects a malformed watermark before Telegram is touched', async () => {
    const { client, reads } = fakeClient();
    await expect(dispatchRpc(client, 'readHistory', { chatId: 2, maxId: -1 })).rejects.toThrow('Expected a non-negative integer');
    expect(reads).toEqual([]);
  });
});

describe('getHistory dispatch', () => {
  it('returns the window oldest first', async () => {
    const { client, calls } = fakeHistoryClient([[message(12), message(11)]]);
    const result = (await dispatchRpc(client, 'getHistory', { chatId: 1 })) as { messages: Array<{ id: number }> };
    expect(result.messages.map((entry) => entry.id)).toEqual([11, 12]);
    expect(calls).toEqual([{ chatId: 1, params: { limit: 50 } }]);
  });

  it('completes the oldest album at the window edge', async () => {
    const { client, calls } = fakeHistoryClient([
      [message(13, 7), message(12, 7), message(11, 7)],
      [message(10, 7), message(9, 7)],
    ]);
    const result = (await dispatchRpc(client, 'getHistory', { chatId: 1, limit: 3 })) as { messages: Array<{ id: number }> };
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
    const result = (await dispatchRpc(client, 'getHistory', { chatId: 1, limit: 2 })) as { messages: Array<{ id: number }> };
    expect(result.messages.map((entry) => entry.id)).toEqual([19, 20]);
    expect(calls).toHaveLength(2);
  });

  it('skips the extra fetch when the oldest message is not grouped', async () => {
    const { client, calls } = fakeHistoryClient([[message(2), message(1)]]);
    await dispatchRpc(client, 'getHistory', { chatId: 1, limit: 2 });
    expect(calls).toHaveLength(1);
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
    const result = (await dispatchRpc(client, 'sendVote', { chatId: 1, messageId: 7, options: [0] })) as {
      poll: { id: string; totalVoters: number | null; answers: unknown[] };
    };
    expect(votes).toEqual([{ chatId: 1, message: 7, options: [0] }]);
    expect(result.poll.id).toBe('1234567890');
    expect(result.poll.totalVoters).toBe(1);
    expect(result.poll.answers).toEqual([{ text: 'Tea', voters: 1, chosen: true, correct: null }]);
  });

  it('reads a missing selection as a retraction', async () => {
    const { client, votes } = fakeVoteClient();
    await dispatchRpc(client, 'sendVote', { chatId: 1, messageId: 7 });
    expect(votes).toEqual([{ chatId: 1, message: 7, options: null }]);
  });

  it('rejects malformed selections before Telegram is touched', async () => {
    const { client, votes } = fakeVoteClient();
    for (const options of [[], 'Tea', [1.5], [-1], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) {
      await expect(dispatchRpc(client, 'sendVote', { chatId: 1, messageId: 7, options })).rejects.toThrow('options');
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
    const result = (await dispatchRpc(client, 'getPollResults', { chatId: 1, messageId: 7 })) as {
      poll: { question: string; totalVoters: number | null };
    };
    expect(calls).toEqual([{ chatId: 1, message: 7 }]);
    expect(result.poll.question).toBe('Tea or coffee?');
    expect(result.poll.totalVoters).toBeNull();
  });
});
