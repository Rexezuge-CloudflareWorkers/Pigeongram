import { Long, Message, PeersIndex } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { toMessageDto } from '../../packages/backend-services/src/session/dto';
import { resolveReplyPreviews } from '../../packages/backend-services/src/session/reply-previews';
import type { MessageDto } from '../../packages/shared/src/types';

/**
 * Reply previews against a fake client: which headers ask for a read, and what
 * the resolved header carries. The snippets themselves come from the same
 * `toMessageDto` the thread uses, so a preview reads exactly like a loaded
 * original would.
 */

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
      lastName: 'Lovelace',
      username: 'ada',
    } as unknown as tl.RawUser,
    {
      _: 'user',
      id: 2,
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
      firstName: 'Bob',
    } as unknown as tl.RawUser,
  ],
  chats: [
    {
      _: 'channel',
      id: 20,
      title: 'Announcements',
      username: 'announce',
      broadcast: true,
      megagroup: false,
      date: 1_700_000_000,
      accessHash: Long.fromNumber(20_000),
    } as unknown as tl.RawChannel,
  ],
});

const CHAT_ID = 2;

function message(id: number, overrides: Record<string, unknown> = {}): Message {
  const raw = {
    _: 'message',
    id,
    peerId: { _: 'peerUser', userId: CHAT_ID },
    fromId: { _: 'peerUser', userId: 1 },
    date: 1_700_000_000,
    message: `m${id}`,
    out: false,
    ...overrides,
  } as unknown as tl.RawMessage;
  return new Message(raw, peers);
}

function reply(id: number, replyToMsgId: number, overrides: Record<string, unknown> = {}): MessageDto {
  return toMessageDto(
    message(id, {
      replyTo: { _: 'messageReplyHeader', replyToMsgId },
      ...overrides,
    }),
  );
}

function document(id: number): Message {
  return message(id, {
    message: '',
    media: {
      _: 'messageMediaDocument',
      document: {
        _: 'document',
        id: Long.fromNumber(31),
        accessHash: Long.fromNumber(310),
        fileReference: new Uint8Array([5]),
        date: 1_700_000_000,
        mimeType: 'application/pdf',
        size: 512,
        dcId: 2,
        attributes: [{ _: 'documentAttributeFilename', fileName: 'notes.pdf' }],
      },
    },
  });
}

function fakeClient(answers: ReadonlyMap<number, Message | null>, options: { fail?: boolean } = {}) {
  const calls: Array<{ chatId: number; ids: number[] }> = [];
  const client = {
    getMessages: async (chatId: number, ids: number[]) => {
      calls.push({ chatId, ids });
      if (options.fail) throw new Error('upstream down');
      return ids.map((id) => answers.get(id) ?? null);
    },
  } as unknown as TelegramClient;
  return { client, calls };
}

describe('resolveReplyPreviews', () => {
  it('fills the sender and snippet of an original outside the page', async () => {
    const { client, calls } = fakeClient(new Map([[5, message(5, { out: true })]]));
    const page = [reply(12, 5)];

    const [resolved] = await resolveReplyPreviews(client, page);

    expect(calls).toEqual([{ chatId: CHAT_ID, ids: [5] }]);
    expect(resolved.reply).toEqual({
      origin: 'same_chat',
      messageId: 5,
      chatId: null,
      senderName: 'Ada Lovelace',
      outgoing: true,
      date: 1_700_000_000_000,
      text: 'm5',
      entities: [],
      mediaKind: null,
      quote: false,
    });
  });

  it('carries a resolved media kind when the original has no text', async () => {
    const { client } = fakeClient(new Map([[5, document(5)]]));

    const [resolved] = await resolveReplyPreviews(client, [reply(12, 5)]);

    expect(resolved.reply).toMatchObject({ text: '', mediaKind: 'document', senderName: 'Ada Lovelace' });
  });

  it('leaves a quote whose original is on the page alone', async () => {
    const { client, calls } = fakeClient(new Map());

    const page = [reply(12, 10), toMessageDto(message(10))];
    const resolved = await resolveReplyPreviews(client, page);

    expect(calls).toEqual([]);
    expect(resolved[0]).toBe(page[0]);
  });

  it('keeps an explicit quote without reading the original', async () => {
    const { client, calls } = fakeClient(new Map());

    const page = [
      reply(12, 5, {
        replyTo: {
          _: 'messageReplyHeader',
          replyToMsgId: 5,
          quote: true,
          quoteText: 'excerpt',
        },
      }),
    ];
    const [resolved] = await resolveReplyPreviews(client, page);

    expect(calls).toEqual([]);
    expect(resolved.reply).toMatchObject({ quote: true, text: 'excerpt', senderName: null });
  });

  it('ignores cross-chat and private reply headers', async () => {
    const { client, calls } = fakeClient(new Map());

    const page = [
      reply(12, 5, {
        replyTo: {
          _: 'messageReplyHeader',
          replyToMsgId: 5,
          replyToPeerId: { _: 'peerChannel', channelId: 20 },
          replyFrom: { _: 'messageFwdHeader', date: 1_700_000_000, fromName: 'Announcements' },
        },
      }),
      reply(13, 6, { replyTo: { _: 'messageReplyHeader', replyFrom: { _: 'messageFwdHeader', date: 1_700_000_000 } } }),
    ];
    const resolved = await resolveReplyPreviews(client, page);

    expect(calls).toEqual([]);
    expect(resolved).toBe(page);
  });

  it('reads each missing original once for the whole page', async () => {
    const { client, calls } = fakeClient(new Map([[5, message(5)]]));

    const page = [reply(12, 5), reply(13, 5), reply(14, 6)];
    await resolveReplyPreviews(client, page);

    expect(calls).toEqual([{ chatId: CHAT_ID, ids: [5, 6] }]);
  });

  it('skips the ids the caller says are never shown', async () => {
    const { client, calls } = fakeClient(new Map([[5, message(5)]]));

    const page = [reply(12, 5)];
    const resolved = await resolveReplyPreviews(client, page, new Set([5]));

    expect(calls).toEqual([]);
    expect(resolved[0]).toBe(page[0]);
  });

  it('leaves a deleted original without a preview', async () => {
    const { client } = fakeClient(new Map());
    const page = [reply(12, 5)];

    const [resolved] = await resolveReplyPreviews(client, page);

    expect(resolved.reply).toMatchObject({ senderName: null, text: '', mediaKind: null });
  });

  it('keeps the page when the preview read fails', async () => {
    const { client } = fakeClient(new Map(), { fail: true });
    const page = [reply(12, 5)];

    const resolved = await resolveReplyPreviews(client, page);

    expect(resolved[0].reply).toMatchObject({ messageId: 5, senderName: null, text: '' });
  });

  it('caps how many originals one page reads', async () => {
    const { client, calls } = fakeClient(new Map());

    const page = Array.from({ length: 101 }, (_, index) => reply(1_000 + index, 2_000 + index));
    await resolveReplyPreviews(client, page);

    expect(calls[0].ids).toHaveLength(100);
  });
});
