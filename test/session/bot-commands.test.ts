import { Long } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { readBotCommands } from '../../packages/backend-services/src/session/bot-commands';

describe('readBotCommands', () => {
  it('reads a private bot chat from the full user', async () => {
    const calls: number[] = [];
    const client = {
      getFullUser: async (chatId: number) => {
        calls.push(chatId);
        return {
          full: {
            botInfo: {
              commands: [
                { command: 'start', description: 'Start the bot' },
                { command: 'help', description: 'Show help' },
              ],
            },
          },
        };
      },
    } as unknown as TelegramClient;

    await expect(readBotCommands(client, 5)).resolves.toEqual([
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Show help' },
    ]);
    expect(calls).toEqual([5]);
  });

  it("flattens a group's bots and de-duplicates command names", async () => {
    const calls: number[] = [];
    const client = {
      getFullChat: async (chatId: number) => {
        calls.push(chatId);
        return {
          full: {
            botInfo: [
              {
                commands: [
                  { command: 'start', description: 'First start' },
                  { command: 'settings', description: 'First settings' },
                ],
              },
              {
                commands: [
                  { command: 'start', description: 'Second start' },
                  { command: 'weather', description: 'Show the weather' },
                ],
              },
            ],
          },
        };
      },
    } as unknown as TelegramClient;

    await expect(readBotCommands(client, -100)).resolves.toEqual([
      { command: 'start', description: 'First start' },
      { command: 'settings', description: 'First settings' },
      { command: 'weather', description: 'Show the weather' },
    ]);
    expect(calls).toEqual([-100]);
  });

  it('answers an empty list when the full info carries no bot commands', async () => {
    const client = { getFullUser: async () => ({ full: {} }) } as unknown as TelegramClient;
    await expect(readBotCommands(client, 5)).resolves.toEqual([]);
  });

  it('uses an already resolved peer instead of resolving the chat again', async () => {
    const calls: unknown[] = [];
    const client = {
      getFullChat: async (peer: unknown) => {
        calls.push(peer);
        return { full: { botInfo: [{ commands: [{ command: 'rules', description: 'Read the rules' }] }] } };
      },
    } as unknown as TelegramClient;
    const peer = { _: 'inputPeerChannel', channelId: 30, accessHash: Long.fromNumber(30_000) } as const;

    await expect(readBotCommands(client, -1_000_000_000_030, peer)).resolves.toEqual([{ command: 'rules', description: 'Read the rules' }]);
    expect(calls).toEqual([peer]);
  });
});
