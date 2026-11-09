import { act, cleanup, renderHook } from '@testing-library/react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentsThread } from '../../apps/web/src/state';
import type { MessageDto, MessagePollDto } from '../../apps/web/src/types';

/**
 * The comments screen's poll handling: fold a fresh poll into the pinned post
 * or a loaded comment, recheck a short update, and cast votes through the
 * shared poll action.
 */

const api = vi.hoisted(() => ({ fetchPollResults: vi.fn(), sendVote: vi.fn() }));
vi.mock('../../apps/web/src/api', () => api);

const { useCommentsPoll } = await import('../../apps/web/src/useCommentsPoll');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function poll(id = '900', overrides: Partial<MessagePollDto> = {}): MessagePollDto {
  return {
    id,
    question: 'Pick one',
    answers: [
      { text: 'A', voters: 1, chosen: false, correct: null },
      { text: 'B', voters: 2, chosen: false, correct: null },
    ],
    totalVoters: 3,
    closed: false,
    quiz: false,
    multiple: false,
    revotingDisabled: false,
    hideResultsUntilClose: false,
    solution: null,
    ...overrides,
  };
}

function message(id: number, messagePoll: MessagePollDto | null = null): MessageDto {
  return {
    id,
    chatId: 100,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000 + id,
    text: '',
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: messagePoll,
    markup: null,
    replyKeyboard: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  };
}

function thread(overrides: Partial<CommentsThread> = {}): CommentsThread {
  return {
    chat: {
      id: 2,
      kind: 'channel',
      title: 'Channel',
      username: 'channel',
      photo: null,
      canSendMessages: true,
      presence: null,
    },
    post: { ...message(10, poll('900')), chatId: 2 },
    discussionChatId: 100,
    discussionMessageId: 500,
    botCommands: [],
    comments: [message(1, poll('901'))],
    count: 1,
    nextOffset: null,
    newMessageIds: new Set(),
    ...overrides,
  };
}

function harness(initial: CommentsThread | null = thread()) {
  let state = initial;
  const threadRef: RefObject<CommentsThread | null> = { current: initial };
  const setThread: Dispatch<SetStateAction<CommentsThread | null>> = (update) => {
    state = typeof update === 'function' ? (update as (current: CommentsThread | null) => CommentsThread | null)(state) : update;
    threadRef.current = state;
  };
  const onError = vi.fn();
  const { result } = renderHook(() => useCommentsPoll(threadRef, setThread, onError));
  return { result, onError, current: () => state };
}

describe('useCommentsPoll', () => {
  it('folds a poll into the pinned post', () => {
    const test = harness();
    const next = poll('900', { totalVoters: 40 });

    act(() => test.result.current.applyPoll({ chatId: 2, messageId: 10, pollId: '900' }, next));

    expect(test.current()?.post.poll).toEqual(next);
  });

  it('folds a poll into a loaded comment', () => {
    const test = harness();
    const next = poll('901', { totalVoters: 7 });

    act(() => test.result.current.applyPoll({ chatId: 100, messageId: 1, pollId: '901' }, next));

    expect(test.current()?.comments[0]?.poll).toEqual(next);
  });

  it('rechecks a short update and folds the fresh result in', async () => {
    const test = harness();
    api.fetchPollResults.mockResolvedValue({ poll: poll('900', { totalVoters: 99 }) });

    act(() => test.result.current.refreshPoll({ chatId: null, messageId: null, pollId: '900' }));

    await vi.waitFor(() => expect(test.current()?.post.poll?.totalVoters).toBe(99));
    expect(api.fetchPollResults).toHaveBeenCalledWith(2, 10);
  });

  it('stays silent when the poll is not on screen or the read fails', async () => {
    const test = harness();
    api.fetchPollResults.mockRejectedValue(new Error('offline'));

    act(() => test.result.current.refreshPoll({ chatId: null, messageId: null, pollId: 'missing' }));
    expect(api.fetchPollResults).not.toHaveBeenCalled();

    act(() => test.result.current.refreshPoll({ chatId: null, messageId: null, pollId: '900' }));
    await vi.waitFor(() => expect(api.fetchPollResults).toHaveBeenCalledOnce());

    expect(test.onError).not.toHaveBeenCalled();
  });

  it('does nothing while the comments screen is closed', () => {
    const test = harness(null);

    act(() => test.result.current.refreshPoll({ chatId: null, messageId: null, pollId: '900' }));

    expect(api.fetchPollResults).not.toHaveBeenCalled();
  });

  it('casts a vote through the shared action and folds the answer', async () => {
    const test = harness();
    api.sendVote.mockResolvedValue({ poll: poll('900', { totalVoters: 12 }) });

    act(() => test.result.current.vote({ ...message(10, poll('900')), chatId: 2 }, [1]));

    await vi.waitFor(() => expect(test.current()?.post.poll?.totalVoters).toBe(12));
    expect(api.sendVote).toHaveBeenCalledWith(2, 10, [1]);
  });

  it('reports a failed vote and clears the in-flight set', async () => {
    const test = harness();
    api.sendVote.mockRejectedValue(new Error('offline'));

    act(() => test.result.current.vote({ ...message(10, poll('900')), chatId: 2 }, [1]));

    await vi.waitFor(() => expect(test.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' })));
    expect(test.result.current.votingIds.size).toBe(0);
  });
});
