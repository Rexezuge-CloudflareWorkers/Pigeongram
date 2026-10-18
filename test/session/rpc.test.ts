import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { dispatchRpc } from '../../worker/src/session/rpc';

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
