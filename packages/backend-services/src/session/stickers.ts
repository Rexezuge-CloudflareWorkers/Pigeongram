import { Long, Sticker } from '@mtcute/core';
import type { StickerSet, tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { StickerLibraryDto, StickerSetDto } from '../types';
import type { MessageDto } from '../types';
import { toMessageDto } from './dto';
import { toStickerDto, toStickerSetDto } from './dto-sticker';
import { EngineError } from './errors';
import { optionalMessageId, optionalRandomId, parseLong, requirePeerId, requireRecord } from './params';
import type { PartialMethodTable } from './rpc-methods';
import type { StickerRegistry } from './sticker-registry';

/**
The sticker half of the bridge: the picker's library, one pack in full, the
send and the install a `t.me/addstickers` link offers.

Telegram has no high-level recent/faved sticker read in mtcute, so those two
are raw TL calls whose documents are turned into `Sticker` objects here.
Their ids are what the picker names; the engine keeps the documents in
{@link StickerRegistry} and never hands a file reference to the browser.
*/

const RECENT_LIMIT = 60;

/**
The raw-document parser: a sticker is the document that carries the sticker
(or custom-emoji) attribute, and its size lives on the image or video
attribute beside it.
*/
function parseSticker(doc: tl.TypeDocument): Sticker | null {
  if (doc._ !== 'document') return null;
  const attr = doc.attributes.find(
    (attribute): attribute is tl.RawDocumentAttributeSticker | tl.RawDocumentAttributeCustomEmoji =>
      attribute._ === 'documentAttributeSticker' || attribute._ === 'documentAttributeCustomEmoji',
  );
  if (!attr) return null;
  const size = doc.attributes.find(
    (attribute): attribute is tl.RawDocumentAttributeImageSize | tl.RawDocumentAttributeVideo =>
      attribute._ === 'documentAttributeImageSize' || attribute._ === 'documentAttributeVideo',
  );
  return new Sticker(doc, attr, size);
}

function toDtoAll(stickers: readonly Sticker[], registry: StickerRegistry) {
  return stickers.map((sticker) => {
    registry.remember(sticker);
    return toStickerDto(sticker);
  });
}

async function readRecent(client: TelegramClient, attached: boolean): Promise<Sticker[]> {
  const result = await client.call({ _: 'messages.getRecentStickers', attached, hash: Long.ZERO });
  if (result._ !== 'messages.recentStickers') return [];
  return result.stickers.map((doc) => parseSticker(doc)).filter((sticker): sticker is Sticker => sticker !== null);
}

async function readFaved(client: TelegramClient): Promise<Sticker[]> {
  const result = await client.call({ _: 'messages.getFavedStickers', hash: Long.ZERO });
  if (result._ !== 'messages.favedStickers') return [];
  return result.stickers.map((doc) => parseSticker(doc)).filter((sticker): sticker is Sticker => sticker !== null);
}

/**
The picker's opening read: the account's recent and saved stickers, and the
installed packs as brief sets. The three reads are independent and run
concurrently over the one connection.

Only regular sticker packs are listed. An emoji or mask pack holds documents
this client cannot send as a sticker yet, and listing one would offer a send
that Telegram refuses.
*/
export async function readStickerLibrary(client: TelegramClient, registry: StickerRegistry): Promise<StickerLibraryDto> {
  const [recent, faved, installed] = await Promise.all([readRecent(client, false), readFaved(client), client.getInstalledStickers()]);
  return {
    recent: toDtoAll(recent.slice(0, RECENT_LIMIT), registry),
    faved: toDtoAll(faved.slice(0, RECENT_LIMIT), registry),
    sets: installed.filter((set) => set.type === 'sticker').map((set) => toStickerSetDto(set, registry)),
  };
}

/**
Reads one pack in full, addressed either by its Telegram identity or by the
short name a link carries.
*/
export async function readStickerSet(
  client: TelegramClient,
  registry: StickerRegistry,
  params: Record<string, unknown>,
): Promise<StickerSetDto> {
  return toStickerSetDto(await resolveStickerSet(client, params), registry);
}

function optionalDecimal(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new EngineError(`${name} must be a decimal Telegram id`, 400);
  parseLong(value, `${name} must be a decimal Telegram id`);
  return value;
}

interface StickerSetLookup {
  shortName?: unknown;
  id?: unknown;
  accessHash?: unknown;
}

async function resolveStickerSet(client: TelegramClient, params: StickerSetLookup): Promise<StickerSet> {
  const shortName = params.shortName === undefined ? undefined : requireShortName(params.shortName);
  if (shortName !== undefined) return client.getStickerSet(shortName);
  const id = optionalDecimal(params.id, 'id');
  const accessHash = optionalDecimal(params.accessHash, 'accessHash');
  if (id === undefined || accessHash === undefined) {
    throw new EngineError('A sticker set is read by shortName, or by id and accessHash', 400);
  }
  return client.getStickerSet({
    _: 'inputStickerSetID',
    id: parseLong(id, 'id must be a decimal Telegram id'),
    accessHash: parseLong(accessHash, 'accessHash must be a decimal Telegram id'),
  });
}

function requireShortName(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,64}$/i.test(value)) {
    throw new EngineError('shortName must be a sticker pack name', 400);
  }
  return value;
}

interface StickerSetRef {
  id: string;
  accessHash: string;
}

function optionalSetRef(value: unknown): StickerSetRef | undefined {
  if (value === undefined || value === null) return undefined;
  const record = requireRecord(value);
  const id = optionalDecimal(record.id, 'set.id');
  const accessHash = optionalDecimal(record.accessHash, 'set.accessHash');
  if (id === undefined || accessHash === undefined) {
    throw new EngineError('set must carry id and accessHash', 400);
  }
  return { id, accessHash };
}

/**
Resolves a sticker the picker named. The registry is the fast path; the
pack identity is the cold-start fallback after a Durable Object restart,
which is why a send may carry it.
*/
export async function resolveSticker(
  client: TelegramClient,
  registry: StickerRegistry,
  documentId: string,
  set: StickerSetRef | undefined,
): Promise<Sticker> {
  const id = parseLong(documentId, 'documentId must be a decimal Telegram id').toString();
  const known = registry.get(id);
  if (known !== null) return known;
  if (set === undefined) {
    throw new EngineError('Sticker is no longer available', 404);
  }
  const full = await resolveStickerSet(client, set);
  const sticker = full.isFull ? full.stickers.find((info) => info.sticker.raw.id.toString() === id)?.sticker : undefined;
  if (!sticker) throw new EngineError('Sticker is no longer in its pack', 404);
  registry.remember(sticker);
  return sticker;
}

/**
Sends one sticker. `randomId` is reused by the outbox's retry, so a send that
actually landed is not duplicated.
*/
export async function sendStickerMessage(
  client: TelegramClient,
  registry: StickerRegistry,
  params: Record<string, unknown>,
): Promise<MessageDto> {
  const chatId = requirePeerId(params.chatId);
  const documentId = optionalDecimal(params.documentId, 'documentId');
  if (documentId === undefined) throw new EngineError('documentId is required', 400);
  const sticker = await resolveSticker(client, registry, documentId, optionalSetRef(params.set));
  const replyTo = optionalMessageId(params.replyTo);
  const randomId = optionalRandomId(params.randomId);
  const message = await client.sendMedia(chatId, sticker.inputDocument, {
    clearDraft: true,
    ...(replyTo !== undefined && { replyTo }),
    ...(randomId !== undefined && { randomId }),
  });
  return toMessageDto(message);
}

/**
Installs the pack a link names. The answer is the pack itself, so the picker
and the toast can name it without a second read.
*/
export async function installStickerSet(
  client: TelegramClient,
  registry: StickerRegistry,
  params: Record<string, unknown>,
): Promise<StickerSetDto> {
  const shortName = requireShortName(params.shortName);
  await client.call({
    _: 'messages.installStickerSet',
    stickerset: { _: 'inputStickerSetShortName', shortName },
    archived: false,
  });
  return toStickerSetDto(await client.getStickerSet(shortName), registry);
}

/**
The sticker surface, as one entry per method. The library and one pack are
reads, so a chat screen can batch them; sending and installing are writes.
*/
export const stickerRpcMethods = {
  getStickerLibrary: {
    readOnly: true,
    run: async (context) => readStickerLibrary(context.client, context.stickers),
  },

  getStickerSet: {
    readOnly: true,
    run: async (context, params) => ({ set: await readStickerSet(context.client, context.stickers, params) }),
  },

  sendSticker: {
    readOnly: false,
    run: async (context, params) => ({ message: await sendStickerMessage(context.client, context.stickers, params) }),
  },

  installStickerSet: {
    readOnly: false,
    run: async (context, params) => ({ set: await installStickerSet(context.client, context.stickers, params) }),
  },
} as const satisfies PartialMethodTable;
