import type { Message } from '@mtcute/core';
import type { ChatDto } from '../types';
import type { SearchGlobalCursor } from '../search-types';
import { toChatDto, toMessageDto } from './dto';
import { EngineError } from './errors';
import { clampInt, optionalInt, requireMessageId, requirePeerId, requireQuery } from './params';
import type { PartialMethodTable } from './rpc-methods';

/**
 * The search half of the bridge: one chat's messages and the account-wide
 * search.
 *
 * Both reads answer newest first, which is Telegram's own order for a search
 * (the opposite of a history window). The global read also carries the chats
 * its page touches: a result may belong to a chat outside the loaded chat
 * list, and the SPA needs the chat to render and open the row.
 */
export const searchRpcMethods = {
  searchMessages: {
    readOnly: true,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const query = requireQuery(params.query);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offset = optionalInt(params.offsetId);
      const found = await context.client.searchMessages({
        chatId,
        query,
        limit,
        ...(offset !== undefined && { offset }),
      });
      return { messages: found.map(toMessageDto), nextOffsetId: found.next };
    },
  },

  searchGlobal: {
    readOnly: true,
    run: async (context, params) => {
      const query = requireQuery(params.query);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offset = readSearchOffset(params.offset);
      // Telegram's cursor carries an input peer; the bridge carries the marked
      // id and resolves it here, so no access hash crosses the wire.
      const peer = offset === undefined ? undefined : await context.client.resolvePeer(offset.chatId);
      const found = await context.client.searchGlobal({
        query,
        limit,
        ...(offset !== undefined && peer !== undefined && { offset: { rate: offset.rate, peer, id: offset.messageId } }),
      });
      // mtcute derives `next` from the page's last message, so the cursor's
      // chat is that message's chat — no need to decode the input peer.
      const last = found.at(-1);
      const next =
        found.next !== undefined && last !== undefined
          ? { rate: found.next.rate, chatId: last.chat.id, messageId: found.next.id }
          : undefined;
      return {
        messages: found.map(toMessageDto),
        chats: chatsIn(found),
        ...(next !== undefined && { next }),
      };
    },
  },
} as const satisfies PartialMethodTable;

/**
 * Reads the global search cursor. Every field is required: a cursor is either
 * the previous page's whole answer or absent, and a partial one would silently
 * restart the search.
 */
function readSearchOffset(value: unknown): SearchGlobalCursor | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineError('offset must be a search cursor', 400);
  }
  const record = value as Record<string, unknown>;
  const rate = optionalInt(record.rate);
  if (rate === undefined) {
    throw new EngineError('offset.rate must be a non-negative integer', 400);
  }
  return { rate, chatId: requirePeerId(record.chatId), messageId: requireMessageId(record.messageId) };
}

/**
 * The distinct chats of a page, in the order their first message appears.
 */
function chatsIn(messages: readonly Message[]): ChatDto[] {
  const chats = new Map<number, ChatDto>();
  for (const message of messages) {
    if (chats.has(message.chat.id)) continue;
    chats.set(message.chat.id, toChatDto(message.chat));
  }
  return [...chats.values()];
}
