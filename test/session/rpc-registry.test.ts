import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import type { RpcMethod } from '../../packages/shared/src/rpc-types';
import { CallRegistry } from '../../packages/backend-services/src/session/call-registry';
import { dispatchRpc } from '../../packages/backend-services/src/session/rpc';
import { BATCHABLE_METHODS, RPC_METHODS } from '../../packages/backend-services/src/session/rpc-methods';
import { albumLedger } from './rpc-dispatch';

/**
 * The method table is the one place the bridge's surface is classified.
 *
 * The list below is the contract, written out on purpose: it is what a reader
 * of `rpc-types.ts` sees, and comparing the table against it is what catches a
 * method added to one side and forgotten on the other. The read-only split is
 * the batch whitelist, and a write that slipped into it would run with no
 * defined completion order.
 */
const CONTRACT_METHODS: readonly RpcMethod[] = [
  'getMe',
  'getDialogs',
  'getHistory',
  'sendMessage',
  'forwardMessages',
  'readHistory',
  'searchMessages',
  'sendReaction',
  'sendVote',
  'pressCallbackButton',
  'getPollResults',
  'getComments',
  'sendComment',
  'getBotCommands',
  'setArchived',
  'getProfile',
  'getCallDhConfig',
  'requestCall',
  'receivedCall',
  'acceptCall',
  'confirmCall',
  'discardCall',
  'rateCall',
  'batch',
];

const CONTRACT_BATCHABLE: readonly RpcMethod[] = [
  'getMe',
  'getDialogs',
  'getHistory',
  'searchMessages',
  'getPollResults',
  'getComments',
  'getBotCommands',
  'getProfile',
];

function fakeClient(): TelegramClient {
  return {} as TelegramClient;
}

function dispatch(method: string, params: unknown): Promise<unknown> {
  return dispatchRpc(fakeClient(), method, params, albumLedger(), new CallRegistry());
}

describe('RPC method registry', () => {
  it('classifies every contract method exactly once', () => {
    expect(Object.keys(RPC_METHODS).sort()).toEqual([...CONTRACT_METHODS].sort());
  });

  it('derives the batch whitelist from the read-only entries', () => {
    expect([...BATCHABLE_METHODS].sort()).toEqual([...CONTRACT_BATCHABLE].sort());
    for (const method of BATCHABLE_METHODS) {
      expect(RPC_METHODS[method].readOnly, method).toBe(true);
    }
  });

  it('classifies every method outside the whitelist as a write', () => {
    const batchable = new Set<string>(BATCHABLE_METHODS);
    for (const method of CONTRACT_METHODS) {
      if (batchable.has(method)) continue;
      expect(RPC_METHODS[method].readOnly, method).toBe(false);
    }
  });

  it('keeps the watermark read and the archive move out of a batch', () => {
    expect(BATCHABLE_METHODS).not.toContain('readHistory');
    expect(BATCHABLE_METHODS).not.toContain('setArchived');
  });

  it('refuses a batch that carries a write', async () => {
    for (const method of ['sendMessage', 'readHistory', 'setArchived', 'requestCall', 'batch']) {
      await expect(dispatch('batch', { calls: [{ method }] })).rejects.toThrow('batchable read method');
    }
  });

  it('404s a method the table does not carry, including a prototype name', async () => {
    for (const method of ['doesNotExist', 'constructor', 'toString']) {
      await expect(dispatch(method, {})).rejects.toMatchObject({ status: 404 });
    }
  });
});
