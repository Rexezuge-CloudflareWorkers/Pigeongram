import type { DownloadableMedia } from './media';

/**
The resolved media behind a message, remembered between byte-range requests.

Resolving a message costs Telegram a `messages.getMessages` round trip (or
`channels.getMessages`), and mtcute's `getMessages` has no cache of its own.
A `<video>` open issues several range requests and every seek issues another,
so resolving each one made the player wait for a network round trip before a
single byte moved. The location itself — file reference and access hash
included — is stable for a while, so a short-lived in-memory entry turns all
of those into a map lookup.

It is memory-only and bounded: a Durable Object restart drops it, and the TTL
keeps a `file_reference` from outliving Telegram's tolerance. A download that
fails evicts its entry through the stream's `onSourceError` hook, so a
reference Telegram has already rejected is never reused.
*/
export class MediaTargetCache {
  readonly #entries = new Map<string, { file: DownloadableMedia; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maxEntries = 64,
    private readonly now: () => number = Date.now,
  ) {}

  get(chatId: number, messageId: number): DownloadableMedia | null {
    const key = entryKey(chatId, messageId);
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return null;
    }
    // Refresh the insertion order so the map evicts the least recently used.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.file;
  }

  set(chatId: number, messageId: number, file: DownloadableMedia): void {
    const key = entryKey(chatId, messageId);
    this.#entries.delete(key);
    this.#entries.set(key, { file, expiresAt: this.now() + this.ttlMs });
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  delete(chatId: number, messageId: number): void {
    this.#entries.delete(entryKey(chatId, messageId));
  }

  clear(): void {
    this.#entries.clear();
  }
}

function entryKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}
