import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../packages/backend-services/src/session/errors';
import { dispatchBatch } from '../../packages/backend-services/src/session/rpc-batch';

/**
A batch answers `200` even when one of its reads fails, so its outcomes do
not pass through the HTTP boundary that masks unknown errors. The masking has
to happen in the batch itself.
*/
const client = {} as TelegramClient;
const calls = [{ method: 'getMe' }] as const;

describe('dispatchBatch', () => {
  it('keeps a typed failure and its code', async () => {
    const { results } = await dispatchBatch(client, calls, async () => {
      throw new EngineError('That chat is gone', 404);
    });
    expect(results[0]).toEqual({ ok: false, error: 'That chat is gone', code: 'not_found' });
  });

  it('masks an unexpected error instead of leaking its message', async () => {
    const { results } = await dispatchBatch(client, calls, async () => {
      throw new Error('internal connection string: secret');
    });
    expect(results[0]).toEqual({ ok: false, error: 'Internal server error', code: 'internal' });
  });

  it("keeps Telegram's own refusal text, which describes the account", async () => {
    const { results } = await dispatchBatch(client, calls, async () => {
      const failure = new Error('rpc call failed') as Error & { text: string };
      failure.text = 'PEER_ID_INVALID';
      throw failure;
    });
    expect(results[0]).toMatchObject({
      ok: false,
      code: 'not_found',
      error: 'That chat is not reachable from this account any more.',
    });
  });

  it('keeps a successful result alongside a failed call', async () => {
    const { results } = await dispatchBatch(client, [{ method: 'getMe' }, { method: 'getDialogs' }], async (method) => {
      if (method === 'getMe') return { id: 1 };
      throw new EngineError('nope', 409);
    });
    expect(results).toEqual([
      { ok: true, result: { id: 1 } },
      { ok: false, error: 'nope', code: 'conflict' },
    ]);
  });
});
