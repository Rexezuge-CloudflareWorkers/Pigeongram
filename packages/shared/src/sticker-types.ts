/**
The sticker half of the bridge contract: the picker's library, one pack, the
send and the install a `t.me/addstickers` link offers. Split from
`rpc-types.ts` so the method shapes stay under the god-file cap; the SPA
mirrors these in `apps/web/src/types.ts`.
*/

import type { MessageDto, PeerId, StickerLibraryDto, StickerSetDto } from './types';

/**
Reads the picker's library: the account's recent and saved stickers, and the
installed packs as brief sets.
*/
export type GetStickerLibraryResult = StickerLibraryDto;

/**
Reads one pack in full. A pack is addressed either by its Telegram identity
(`id` + `accessHash`) or by its short name (a `t.me/addstickers` link).
*/
export interface GetStickerSetParams {
  /**
  Decimal id of the sticker set, with `accessHash`.
  */
  id?: string;
  /**
  Decimal access hash of the sticker set, with `id`.
  */
  accessHash?: string;
  /**
  The pack's short name, when its Telegram identity is not known.
  */
  shortName?: string;
}

export interface GetStickerSetResult {
  set: StickerSetDto;
}

/**
Sends a sticker the picker offered.

The sticker is named by the document id the bridge minted into the library; the
engine resolves it from its own registry. `set` is only the cold-start
fallback: after a Durable Object restart the registry is empty, and the pack's
identity is what lets the engine read it again instead of failing the send.
*/
export interface SendStickerParams {
  chatId: PeerId;
  /**
  Decimal document id of the sticker, as a `StickerDto` carried it.
  */
  documentId: string;
  /**
  Id of the message to reply to, in the same chat.
  */
  replyTo?: number;
  /**
  Client-chosen Telegram `random_id`, so a retried send is not duplicated.
  */
  randomId?: string;
  /**
  The pack the sticker came from, for the registry's cold-start fallback.
  */
  set?: {
    id: string;
    accessHash: string;
  };
}

export interface SendStickerResult {
  message: MessageDto;
}

/**
Installs a sticker pack the account does not have yet — the action a
`t.me/addstickers` link offers.
*/
export interface InstallStickerSetParams {
  shortName: string;
}

export interface InstallStickerSetResult {
  set: StickerSetDto;
}
