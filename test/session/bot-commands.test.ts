import { Long } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { readChatMenu } from '../../packages/backend-services/src/session/bot-commands';

describe('readChatMenu', () => {
  it('reads a private bot chat from the full user', async () => {
    const calls: number[] = [];
    const client = {
      getFullUser: async (chatId: number) => {
        calls.push(chatId);
        return {
          bio: 'Short bio.',
          full: {
            botInfo: {
              description: 'Answers questions.',
              commands: [
                { command: 'start', description: 'Start the bot' },
                { command: 'help', description: 'Show help' },
              ],
            },
          },
        };
      },
    } as unknown as TelegramClient;

    await expect(readChatMenu(client, 5)).resolves.toEqual({
      commands: [
        { command: 'start', description: 'Start the bot' },
        { command: 'help', description: 'Show help' },
      ],
      // Telegram's empty-chat introduction is the bot's description, not the
      // profile's bio.
      description: 'Answers questions.',
    });
    expect(calls).toEqual([5]);
  });

  it("flattens a group's bots and de-duplicates command names", async () => {
    const calls: number[] = [];
    const client = {
      getFullChat: async (chatId: number) => {
        calls.push(chatId);
        return {
          full: {
            about: 'A group about engines.',
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

    await expect(readChatMenu(client, -100)).resolves.toEqual({
      commands: [
        { command: 'start', description: 'First start' },
        { command: 'settings', description: 'First settings' },
        { command: 'weather', description: 'Show the weather' },
      ],
      description: 'A group about engines.',
    });
    expect(calls).toEqual([-100]);
  });

  it('answers an empty list and no description when the full info carries neither', async () => {
    const client = { getFullUser: async () => ({ full: {} }) } as unknown as TelegramClient;
    await expect(readChatMenu(client, 5)).resolves.toEqual({ commands: [], description: null });
  });

  it('falls back to the bio when a bot has no description', async () => {
    const client = {
      getFullUser: async () => ({ bio: 'A bot with only a bio.', full: { botInfo: {} } }),
    } as unknown as TelegramClient;
    await expect(readChatMenu(client, 5)).resolves.toEqual({ commands: [], description: 'A bot with only a bio.' });
  });

  it('uses an already resolved peer instead of resolving the chat again', async () => {
    const calls: unknown[] = [];
    const client = {
      getFullChat: async (peer: unknown) => {
        calls.push(peer);
        return {
          full: {
            about: 'Rules live here.',
            botInfo: [{ commands: [{ command: 'rules', description: 'Read the rules' }] }],
          },
        };
      },
    } as unknown as TelegramClient;
    const peer = { _: 'inputPeerChannel', channelId: 30, accessHash: Long.fromNumber(30_000) } as const;

    await expect(readChatMenu(client, -1_000_000_000_030, peer)).resolves.toEqual({
      commands: [{ command: 'rules', description: 'Read the rules' }],
      description: 'Rules live here.',
    });
    expect(calls).toEqual([peer]);
  });
});
