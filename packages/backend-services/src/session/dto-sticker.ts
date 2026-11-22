import type { Sticker, StickerSet } from '@mtcute/core';
import type { StickerDto, StickerSetDto } from '../types';
import type { StickerRegistry } from './sticker-registry';

/**
The sticker half of the DTO mapping: a sticker document and the pack it came
from, as the picker reads them.

The document itself never leaves the engine. `id` is the decimal document id
and `version` is Telegram's own token for that revision, so the preview URL
can be cached and busted without the browser ever naming a file reference.
*/

export function toStickerDto(sticker: Sticker): StickerDto {
  return {
    id: sticker.raw.id.toString(),
    emoji: sticker.emoji === '' ? null : sticker.emoji,
    kind: sticker.sourceType,
    width: sticker.width,
    height: sticker.height,
    version: sticker.uniqueFileId,
  };
}

/**
Maps one pack. A brief set carries no stickers — the picker shows its cover
and reads the pack when the reader opens it — so `stickers` is empty there
rather than throwing on `StickerSet.stickers`.

Every document that does come through is remembered on the way out, because
the preview and the send address it by the id this mapping mints.
*/
export function toStickerSetDto(set: StickerSet, registry: StickerRegistry): StickerSetDto {
  const stickers = set.isFull ? set.stickers.map((info) => info.sticker) : [];
  for (const sticker of stickers) registry.remember(sticker);
  const cover = stickers[0] ?? set.covers[0] ?? null;
  if (cover !== null) registry.remember(cover);
  return {
    id: set.brief.id.toString(),
    accessHash: set.brief.accessHash.toString(),
    shortName: set.shortName,
    title: set.title,
    kind: set.type,
    count: set.count,
    installed: set.installedDate !== null,
    thumb: cover === null ? null : toStickerDto(cover),
    stickers: stickers.map(toStickerDto),
  };
}
