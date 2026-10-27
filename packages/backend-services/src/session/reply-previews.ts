import type { TelegramClient } from '@mtcute/core/client.js';
import type { MessageDto, MessageReplyDto } from '../types';
import { toMessageDto } from './dto';

/**
 * Reply previews for originals outside the page being read.
 *
 * A same-chat reply header carries only the replied-to message id — Telegram
 * leaves the sender and snippet out — so the SPA resolves the quote from the
 * thread it has loaded. When the original sits outside the page, that lookup
 * misses and the quote would render as unavailable; this module fills the
 * header while the engine still holds the read event, with one `getMessages`
 * per chat for the ids the page names but does not contain.
 *
 * Live-only gap kept on purpose: a reply arriving over the updates socket is
 * not enriched, so its quote fills in on the next read of the thread.
 */

/**
 * How many originals one page may ask for. A page is at most 100 messages, so
 * the cap only guards against a malformed caller and keeps the extra read one
 * request.
 */
const MAX_PREVIEWS = 100;

/**
 * Fills the reply headers whose same-chat originals are neither on the page
 * nor in `ignoredIds` (the comments thread's root, whose quote is hidden).
 *
 * Best effort: an original Telegram no longer returns (deleted) or a rejected
 * read leaves the header as it was, and the quote falls back to its
 * "unavailable" body. Returns the input untouched when nothing needs resolving.
 */
export async function resolveReplyPreviews(
  client: TelegramClient,
  messages: MessageDto[],
  ignoredIds: ReadonlySet<number> = new Set(),
): Promise<MessageDto[]> {
  const loadedIds = new Set(messages.map((message) => message.id));
  const missing = missingOriginals(messages, loadedIds, ignoredIds);
  if (missing.size === 0) return messages;

  const previews = new Map<string, MessageDto>();
  await Promise.all(
    [...missing].map(async ([chatId, ids]) => {
      for (const preview of await fetchOriginals(client, chatId, [...ids])) {
        previews.set(previewKey(chatId, preview.id), preview);
      }
    }),
  );

  return messages.map((message) => {
    const reply = message.reply;
    if (!needsPreview(reply, loadedIds, ignoredIds)) return message;
    const preview = previews.get(previewKey(message.chatId, reply.messageId));
    if (!preview) return message;
    return {
      ...message,
      reply: {
        ...reply,
        senderName: preview.senderName,
        outgoing: preview.outgoing,
        date: preview.date,
        text: preview.text,
        entities: preview.entities,
        mediaKind: preview.media?.kind ?? null,
      },
    };
  });
}

/**
 * The ids each chat's page names but does not contain, deduplicated and capped.
 */
function missingOriginals(
  messages: readonly MessageDto[],
  loadedIds: ReadonlySet<number>,
  ignoredIds: ReadonlySet<number>,
): Map<number, Set<number>> {
  const missing = new Map<number, Set<number>>();
  for (const message of messages) {
    const reply = message.reply;
    if (!needsPreview(reply, loadedIds, ignoredIds)) continue;
    const ids = missing.get(message.chatId) ?? new Set<number>();
    if (ids.size >= MAX_PREVIEWS) continue;
    ids.add(reply.messageId);
    missing.set(message.chatId, ids);
  }
  return missing;
}

/**
 * Whether a header still needs its original read: a same-chat reply with no
 * explicit fragment, no resolved text yet, whose target is not on the page.
 */
function needsPreview(
  reply: MessageReplyDto | null,
  loadedIds: ReadonlySet<number>,
  ignoredIds: ReadonlySet<number>,
): reply is MessageReplyDto & { messageId: number } {
  if (!reply) return false;
  if (reply.origin !== 'same_chat') return false;
  if (reply.messageId === null) return false;
  // An explicit quote already carries the fragment Telegram sent; the
  // original must not replace it.
  if (reply.quote || reply.text !== '') return false;
  if (loadedIds.has(reply.messageId)) return false;
  return !ignoredIds.has(reply.messageId);
}

/**
 * Reads the originals of one chat. A failed read is swallowed: the page's
 * messages are worth returning with a fallback quote rather than failing the
 * whole window over a preview.
 */
async function fetchOriginals(client: TelegramClient, chatId: number, ids: number[]): Promise<MessageDto[]> {
  try {
    const found = await client.getMessages(chatId, ids);
    return found.filter((message) => message !== null).map(toMessageDto);
  } catch {
    return [];
  }
}

function previewKey(chatId: number, messageId: number): string {
  return `${String(chatId)}:${String(messageId)}`;
}
