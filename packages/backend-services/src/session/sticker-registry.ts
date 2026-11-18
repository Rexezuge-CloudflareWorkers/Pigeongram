import type { Sticker } from '@mtcute/core';

/**
 * The stickers the engine has read, addressed by their decimal document id.
 *
 * The bridge's rule is that the browser never carries a file reference: a
 * sticker is named by an id the engine minted, and the document — access hash
 * and `file_reference` included — stays here. A Durable Object restart empties
 * the map, which is why `sendSticker` accepts the pack's identity as a
 * fallback; the preview route has no such fallback, so a stale page's preview
 * is a 404 and the picker reads its library again.
 *
 * Bounded because the map lives in the isolate: the newest entries are kept and
 * the oldest evicted, which is enough for a picker whose reads and sends happen
 * seconds apart.
 */
const MAX_ENTRIES = 600;

export class StickerRegistry {
  readonly #stickers = new Map<string, Sticker>();

  /**
   * Remembers a sticker and answers the id the bridge will use for it. Re-adding
   * an id moves it to the newest position, so an actively used sticker is never
   * the one evicted.
   */
  remember(sticker: Sticker): string {
    const id = sticker.raw.id.toString();
    this.#stickers.delete(id);
    this.#stickers.set(id, sticker);
    if (this.#stickers.size > MAX_ENTRIES) {
      const oldest = this.#stickers.keys().next();
      if (!oldest.done) this.#stickers.delete(oldest.value);
    }
    return id;
  }

  get(id: string): Sticker | null {
    return this.#stickers.get(id) ?? null;
  }

  clear(): void {
    this.#stickers.clear();
  }
}
