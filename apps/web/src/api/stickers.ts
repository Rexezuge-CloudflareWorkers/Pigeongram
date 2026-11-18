import type { InstallStickerSetResult, SendStickerResult, StickerLibraryDto, StickerSetDto } from '../types';
import { rpc } from './request';

/**
 * The sticker half of the bridge: the picker's library, one pack, the send and
 * the install a `t.me/addstickers` link offers.
 *
 * A sticker is named by its decimal document id, never by a file reference:
 * the engine keeps the document and serves its bytes through `/user/sticker`.
 */

export function fetchStickerLibrary(): Promise<StickerLibraryDto> {
  return rpc<StickerLibraryDto>('getStickerLibrary');
}

export function fetchStickerSet(params: { shortName: string } | { id: string; accessHash: string }): Promise<StickerSetDto> {
  return rpc<{ set: StickerSetDto }>('getStickerSet', params).then((result) => result.set);
}

export function installStickerSet(shortName: string): Promise<StickerSetDto> {
  return rpc<InstallStickerSetResult>('installStickerSet', { shortName }).then((result) => result.set);
}

export function sendSticker(
  chatId: number,
  documentId: string,
  options: {
    replyTo?: number;
    randomId?: string;
    /**
     * The pack the sticker came from, so the send survives an engine restart
     * that emptied its registry.
     */
    set?: { id: string; accessHash: string };
  } = {},
): Promise<SendStickerResult> {
  return rpc<SendStickerResult>('sendSticker', {
    chatId,
    documentId,
    ...(options.replyTo !== undefined && { replyTo: options.replyTo }),
    ...(options.randomId !== undefined && { randomId: options.randomId }),
    ...(options.set !== undefined && { set: options.set }),
  });
}

/**
 * The bytes URL of a sticker. `preview` asks for the thumbnail, which is what a
 * picker cell renders; the version token is only a cache buster — the route
 * resolves the document from the engine's own registry.
 */
export function stickerUrl(documentId: string, version: string, preview = true): string {
  const params = new URLSearchParams({ documentId, v: version });
  if (preview) params.set('thumb', '1');
  return `/user/sticker?${params.toString()}`;
}
