import { HttpStatusError } from '@rexezuge/web/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBootstrap } from '../../apps/web/src/api/chats';
import { fetchChatScreen } from '../../apps/web/src/api/threads';

/**
The two screens that pay for a batch, exercised end to end through the
transport.

`pages.test.tsx` hand-builds batch answers from its own fake, so it verifies
that two fakes agree. Here the real domain client constructs the call list
and folds the real outcome shapes; that is the contract the engine answers.
*/
function installFetch(results: Array<Record<string, unknown>>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Response.json({ results }, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function batchCalls(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(init.body as string) as { params: { calls: Array<Record<string, unknown>> } };
  return body.params.calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBootstrap', () => {
  it('reads the account and the chat list in one event', async () => {
    const fetchMock = installFetch([
      { ok: true, result: { me: { id: 7 } } },
      { ok: true, result: { dialogs: [{ chat: { id: 1 } }] } },
    ]);

    await expect(fetchBootstrap()).resolves.toEqual({ me: { id: 7 }, dialogs: [{ chat: { id: 1 } }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(batchCalls(fetchMock)).toEqual([{ method: 'getMe' }, { method: 'getDialogs', params: { limit: 100 } }]);
  });

  it('survives a failed profile read but not a failed chat list', async () => {
    installFetch([
      { ok: false, error: 'no profile', code: 'not_found' },
      { ok: true, result: { dialogs: [] } },
    ]);
    await expect(fetchBootstrap()).resolves.toEqual({ me: null, dialogs: [] });

    installFetch([
      { ok: true, result: { me: null } },
      { ok: false, error: 'that chat is gone', code: 'not_found' },
    ]);
    await expect(fetchBootstrap()).rejects.toMatchObject({ status: 404, message: 'that chat is gone' } satisfies Partial<HttpStatusError>);
  });
});

describe('fetchChatScreen', () => {
  it('batches the window, commands, comments and pin banner', async () => {
    const fetchMock = installFetch([
      { ok: true, result: { messages: [{ id: 9 }] } },
      { ok: true, result: { commands: [{ command: 'start' }], description: 'A bot' } },
      { ok: true, result: { comments: [], count: 0, discussionChatId: null, discussionMessageId: null, commands: [] } },
      { ok: true, result: { messages: [{ id: 11 }] } },
    ]);

    const screen = await fetchChatScreen(5, 10, { withCommands: true, withLatest: false, commentsLimit: 20 });

    expect(batchCalls(fetchMock)).toEqual([
      { method: 'getHistory', params: { chatId: 5 } },
      { method: 'getBotCommands', params: { chatId: 5 } },
      { method: 'getComments', params: { chatId: 5, messageId: 10, limit: 20 } },
      { method: 'getPinnedMessages', params: { chatId: 5, limit: 1 } },
    ]);
    expect(screen).toMatchObject({
      messages: [{ id: 9 }],
      commands: [{ command: 'start' }],
      description: 'A bot',
      comments: { comments: [], count: 0 },
      pinned: { id: 11 },
      latestMessage: null,
    });
  });

  it('reports a failed comments read without losing the window', async () => {
    installFetch([
      { ok: true, result: { messages: [{ id: 9 }] } },
      { ok: false, error: 'No comments', code: 'not_found' },
    ]);

    const screen = await fetchChatScreen(5, 10, { withPinned: false });

    expect(screen.messages).toEqual([{ id: 9 }]);
    expect(screen.comments).toBeNull();
    expect(screen.commentsError).toBe('No comments');
  });
});
