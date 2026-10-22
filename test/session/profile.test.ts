import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { readProfile } from '../../worker/src/session/profile';

describe('readProfile', () => {
  it("reads a person's profile from the full user", async () => {
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

    await expect(readProfile(client, 1)).resolves.toEqual({
      id: 1,
      kind: 'user',
      title: 'Ada Lovelace',
      username: 'ada',
      about: 'Mathematician.',
      photo: null,
      membersCount: null,
    });
    expect(calls).toEqual([1]);
  });

  it("answers a bot's description when the bot has no bio", async () => {
    const client = {
      getFullUser: async () => ({
        id: 5,
        isBot: true,
        displayName: 'Helper',
        username: 'helper_bot',
        bio: '',
        full: { botInfo: { description: 'Answers questions.' } },
      }),
    } as unknown as TelegramClient;

    await expect(readProfile(client, 5)).resolves.toMatchObject({
      kind: 'bot',
      title: 'Helper',
      about: 'Answers questions.',
    });
  });

  it("reads a group's profile from the full chat", async () => {
    const calls: number[] = [];
    const client = {
      getFullChat: async (chatId: number) => {
        calls.push(chatId);
        return {
          id: 100,
          chatType: 'group',
          title: 'The Analytical Engine',
          username: 'engine',
          bio: 'A group about engines.',
          membersCount: 0,
        };
      },
    } as unknown as TelegramClient;

    await expect(readProfile(client, -100)).resolves.toEqual({
      id: 100,
      kind: 'group',
      title: 'The Analytical Engine',
      username: 'engine',
      about: 'A group about engines.',
      photo: null,
      membersCount: null,
    });
    expect(calls).toEqual([-100]);
  });

  it('reports the members of a channel', async () => {
    const client = {
      getFullChat: async () => ({
        id: 200,
        chatType: 'channel',
        title: 'Notes',
        username: 'notes',
        bio: '',
        membersCount: 1234,
      }),
    } as unknown as TelegramClient;

    await expect(readProfile(client, -200)).resolves.toMatchObject({
      kind: 'channel',
      about: null,
      membersCount: 1234,
    });
  });

  it('answers a peer it cannot resolve as not found', async () => {
    const client = {
      getFullUser: async () => {
        throw new Error('Peer not found');
      },
    } as unknown as TelegramClient;

    await expect(readProfile(client, 7)).rejects.toThrow('Peer not found');
  });
});
