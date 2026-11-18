import { Long, StickerSet } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it, vi } from 'vitest';
import { StickerRegistry } from '../../packages/backend-services/src/session/sticker-registry';
import {
  installStickerSet,
  readStickerLibrary,
  readStickerSet,
  resolveSticker,
  sendStickerMessage,
  stickerRpcMethods,
} from '../../packages/backend-services/src/session/stickers';

/**
 * The sticker bridge: which documents count as stickers, how a pack is mapped,
 * and how a send finds the document the picker named. The registry is the
 * id-to-document map the browser never sees, so these cases pin both the ids it
 * mints and the cold-start fallback that reads the pack again.
 */

function document(id: number, attributes: tl.TypeDocumentAttribute[] = []): tl.RawDocument {
  return {
    _: 'document',
    id: Long.fromNumber(id),
    accessHash: Long.fromNumber(id * 10),
    fileReference: new Uint8Array([id]),
    date: 1_700_000_000,
    mimeType: 'image/webp',
    size: 2048,
    dcId: 2,
    attributes,
  };
}

function stickerDocument(id: number, emoji = '🙂'): tl.RawDocument {
  return document(id, [
    { _: 'documentAttributeSticker', alt: emoji, stickerset: { _: 'inputStickerSetEmpty' } },
    { _: 'documentAttributeImageSize', w: 512, h: 512 },
  ]);
}

function briefSet(id: number, shortName: string, options: { emojis?: boolean; installed?: boolean } = {}): StickerSet {
  return new StickerSet({
    _: 'stickerSet',
    id: Long.fromNumber(id),
    accessHash: Long.fromNumber(id * 10),
    title: `Pack ${String(id)}`,
    shortName,
    count: 1,
    hash: 0,
    ...(options.emojis === true && { emojis: true }),
    ...(options.installed === true && { installedDate: 1_700_000_000 }),
  });
}

function fullSet(id: number, shortName: string, documents: tl.RawDocument[]): StickerSet {
  return new StickerSet({
    _: 'messages.stickerSet',
    set: {
      _: 'stickerSet',
      id: Long.fromNumber(id),
      accessHash: Long.fromNumber(id * 10),
      title: `Pack ${String(id)}`,
      shortName,
      count: documents.length,
      hash: 0,
    },
    packs: [],
    keywords: [],
    documents,
  });
}

function client(overrides: Partial<Record<string, unknown>>): TelegramClient {
  return overrides as unknown as TelegramClient;
}

describe('sticker library', () => {
  it('maps recent and saved documents and lists only regular packs', async () => {
    const fake = client({
      call: vi.fn(async (request: { _: string }) =>
        request._ === 'messages.getRecentStickers'
          ? { _: 'messages.recentStickers', hash: Long.ZERO, packs: [], stickers: [stickerDocument(1), document(2)], dates: [1, 2] }
          : { _: 'messages.favedStickers', hash: Long.ZERO, packs: [], stickers: [stickerDocument(3)], dates: [3] },
      ),
      getInstalledStickers: vi.fn(async () => [briefSet(10, 'cats', { installed: true }), briefSet(11, 'emoji', { emojis: true })]),
    });
    const registry = new StickerRegistry();
    const library = await readStickerLibrary(fake, registry);
    expect(library.recent).toEqual([{ id: '1', emoji: '🙂', kind: 'static', width: 512, height: 512, version: expect.any(String) }]);
    expect(library.faved.map((sticker) => sticker.id)).toEqual(['3']);
    expect(library.sets.map((set) => set.shortName)).toEqual(['cats']);
    expect(library.sets[0]?.installed).toBe(true);
    // The ids the library handed out are what a send will name.
    expect(registry.get('1')).not.toBeNull();
  });

  it('answers an empty library when Telegram has no recents or saved stickers', async () => {
    const fake = client({
      call: vi.fn(async (request: { _: string }) =>
        request._ === 'messages.getRecentStickers'
          ? { _: 'messages.recentStickersNotModified' }
          : { _: 'messages.favedStickersNotModified' },
      ),
      getInstalledStickers: vi.fn(async () => []),
    });
    expect(await readStickerLibrary(fake, new StickerRegistry())).toEqual({ recent: [], faved: [], sets: [] });
  });
});

describe('sticker packs', () => {
  it('reads a pack by short name and maps every sticker', async () => {
    const getStickerSet = vi.fn(async () => fullSet(10, 'cats', [stickerDocument(1), stickerDocument(2, '😺')]));
    const registry = new StickerRegistry();
    const set = await readStickerSet(client({ getStickerSet }), registry, { shortName: 'cats' });
    expect(getStickerSet).toHaveBeenCalledWith('cats');
    expect(set.stickers.map((sticker) => sticker.id)).toEqual(['1', '2']);
    expect(set.thumb?.id).toBe('1');
    expect(set.count).toBe(2);
    expect(registry.get('2')).not.toBeNull();
  });

  it('reads a pack by its Telegram identity', async () => {
    const getStickerSet = vi.fn(async () => fullSet(10, 'cats', [stickerDocument(1)]));
    await readStickerSet(client({ getStickerSet }), new StickerRegistry(), { id: '10', accessHash: '100' });
    expect(getStickerSet).toHaveBeenCalledWith({
      _: 'inputStickerSetID',
      id: Long.fromNumber(10),
      accessHash: Long.fromNumber(100),
    });
  });

  it('installs a pack through the short name and answers the mapped pack', async () => {
    const call = vi.fn(async () => true);
    const getStickerSet = vi.fn(async () => fullSet(10, 'cats', [stickerDocument(1)]));
    const set = await installStickerSet(client({ call, getStickerSet }), new StickerRegistry(), { shortName: 'cats' });
    expect(call).toHaveBeenCalledWith({
      _: 'messages.installStickerSet',
      stickerset: { _: 'inputStickerSetShortName', shortName: 'cats' },
      archived: false,
    });
    expect(set.shortName).toBe('cats');
  });
});

describe('sticker resolution', () => {
  it('answers a sticker the registry already holds without reading the pack', async () => {
    const registry = new StickerRegistry();
    const fake = client({ getStickerSet: vi.fn() });
    const library = await readStickerLibrary(
      client({
        call: vi.fn(async (request: { _: string }) =>
          request._ === 'messages.getRecentStickers'
            ? { _: 'messages.recentStickers', hash: Long.ZERO, packs: [], stickers: [stickerDocument(7)], dates: [1] }
            : { _: 'messages.favedStickersNotModified' },
        ),
        getInstalledStickers: vi.fn(async () => []),
      }),
      registry,
    );
    expect(library.recent.map((sticker) => sticker.id)).toEqual(['7']);
    const sticker = await resolveSticker(fake, registry, '7', undefined);
    expect(sticker.raw.id.toString()).toBe('7');
    expect(fake.getStickerSet as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('falls back to the pack after a restart emptied the registry', async () => {
    const getStickerSet = vi.fn(async () => fullSet(10, 'cats', [stickerDocument(7)]));
    const registry = new StickerRegistry();
    const sticker = await resolveSticker(client({ getStickerSet }), registry, '7', { id: '10', accessHash: '100' });
    expect(getStickerSet).toHaveBeenCalledOnce();
    expect(registry.get('7')).not.toBeNull();
    expect(sticker.raw.id.toString()).toBe('7');
  });

  it('404s a sticker the registry lost and no pack can restore', async () => {
    await expect(resolveSticker(client({}), new StickerRegistry(), '7', undefined)).rejects.toMatchObject({ status: 404 });
  });
});

describe('reading a pack identity', () => {
  it('reads a pack by id and access hash', async () => {
    const getStickerSet = vi.fn(async () => fullSet(10, 'cats', [stickerDocument(1)]));

    await expect(readStickerSet(client({ getStickerSet }), new StickerRegistry(), { id: '10', accessHash: '100' })).resolves.toMatchObject({
      shortName: 'cats',
    });
    expect(getStickerSet).toHaveBeenCalledWith(expect.objectContaining({ _: 'inputStickerSetID', id: Long.fromNumber(10) }));
  });

  it('refuses a pack named by neither, and one with a bad short name', async () => {
    const fake = client({ getStickerSet: vi.fn() });

    await expect(readStickerSet(fake, new StickerRegistry(), {})).rejects.toMatchObject({ status: 400 });
    await expect(readStickerSet(fake, new StickerRegistry(), { shortName: 'bad name!' })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('sending a sticker', () => {
  function sendMedia(result: unknown) {
    return vi.fn(async (_chatId: number, _document: unknown, _params?: { randomId?: Long; replyTo?: number }) => result);
  }

  it('sends the registry document, carrying the reply target and the random id', async () => {
    const registry = new StickerRegistry();
    await readStickerLibrary(
      client({
        call: vi.fn(async (request: { _: string }) =>
          request._ === 'messages.getRecentStickers'
            ? { _: 'messages.recentStickers', hash: Long.ZERO, packs: [], stickers: [stickerDocument(7)], dates: [1] }
            : { _: 'messages.favedStickersNotModified' },
        ),
        getInstalledStickers: vi.fn(async () => []),
      }),
      registry,
    );
    const sendMediaFn = sendMedia({
      id: 9,
      chat: { id: 2 },
      groupedId: null,
      sender: null,
      isOutgoing: true,
      date: new Date(0),
      editDate: null,
      isService: false,
      text: '',
      entities: [],
      reactions: null,
      media: null,
      views: null,
      isPinned: false,
      markup: null,
      replyKeyboard: null,
      raw: { _: 'message', media: null },
      replyToMessage: null,
      forward: null,
      comments: null,
    });
    const fake = client({ sendMedia: sendMediaFn });

    const message = await sendStickerMessage(fake, registry, {
      chatId: 2,
      documentId: '7',
      replyTo: 3,
      randomId: '77',
    });

    expect(message.id).toBe(9);
    const [chatId, document, params] = sendMediaFn.mock.calls[0] ?? [];
    expect(chatId).toBe(2);
    expect(document).toMatchObject({ _: 'inputDocument', id: Long.fromNumber(7) });
    expect(params).toMatchObject({ clearDraft: true, replyTo: 3 });
    expect(params?.randomId?.toString()).toBe('77');
  });

  it('400s a send that names no document id', async () => {
    await expect(sendStickerMessage(client({}), new StickerRegistry(), { chatId: 2 })).rejects.toMatchObject({ status: 400 });
  });

  it('404s a document the registry lost and no pack restores', async () => {
    await expect(
      sendStickerMessage(client({ getStickerSet: vi.fn() }), new StickerRegistry(), { chatId: 2, documentId: '7' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('the sticker method table', () => {
  function context(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      client: client(overrides),
      stickers: new StickerRegistry(),
    } as unknown as Parameters<typeof stickerRpcMethods.getStickerSet.run>[0];
  }

  it('classifies the library and a pack as reads, and sends and installs as writes', () => {
    expect(stickerRpcMethods.getStickerLibrary.readOnly).toBe(true);
    expect(stickerRpcMethods.getStickerSet.readOnly).toBe(true);
    expect(stickerRpcMethods.sendSticker.readOnly).toBe(false);
    expect(stickerRpcMethods.installStickerSet.readOnly).toBe(false);
  });

  it('rejects a malformed pack identity and a non-decimal document id', async () => {
    await expect(
      sendStickerMessage(client({}), new StickerRegistry(), { chatId: 2, documentId: '7', set: { id: '10' } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(sendStickerMessage(client({}), new StickerRegistry(), { chatId: 2, documentId: 7 })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('reads a pack, sends and installs through the method wrappers', async () => {
    const getStickerSet = vi.fn(async () => fullSet(10, 'cats', [stickerDocument(1)]));
    const readContext = context({ getStickerSet });
    const read = (await stickerRpcMethods.getStickerSet.run(readContext, { shortName: 'cats' })) as { set: { shortName: string } };
    expect(read.set.shortName).toBe('cats');

    const installContext = context({
      call: vi.fn(async () => true),
      getStickerSet,
    });
    const installed = (await stickerRpcMethods.installStickerSet.run(installContext, { shortName: 'cats' })) as {
      set: { shortName: string };
    };
    expect(installed.set.shortName).toBe('cats');

    await expect(stickerRpcMethods.sendSticker.run(context({}), { chatId: 2, documentId: '7' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('answers the library through the method wrapper', async () => {
    const base = context({
      call: vi.fn(async (request: { _: string }) =>
        request._ === 'messages.getRecentStickers'
          ? { _: 'messages.recentStickers', hash: Long.ZERO, packs: [], stickers: [stickerDocument(1)], dates: [1] }
          : { _: 'messages.favedStickersNotModified' },
      ),
      getInstalledStickers: vi.fn(async () => [briefSet(10, 'cats')]),
    });
    const library = (await stickerRpcMethods.getStickerLibrary.run(base)) as { sets: unknown[] };
    expect(library.sets).toHaveLength(1);
  });
});
