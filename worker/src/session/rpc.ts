import type { TelegramClient } from '@mtcute/core/client.js';
import type { DialogDto, MessageDto } from '../types';
import { toDialogDto, toMeDto, toMessageDto } from './dto';
import { EngineError } from './errors';
import { clampInt, optionalInt, requirePeerId, requireQuery, requireRecord, requireText } from './params';

/**
 * The curated method surface of `POST /api/rpc`.
 *
 * Deliberately a whitelist — the bridge never forwards raw MTProto from the
 * browser. Every method resolves peers server-side (marked ids in, DTOs out).
 */
export async function dispatchRpc(client: TelegramClient, method: string, rawParams: unknown): Promise<unknown> {
  const params = requireRecord(rawParams);
  switch (method) {
    case 'getMe': {
      return { me: toMeDto(await client.getMe()) };
    }

    case 'getDialogs': {
      const limit = clampInt(params.limit, 1, 200, 100);
      const dialogs: DialogDto[] = [];
      for await (const dialog of client.iterDialogs({ limit })) {
        dialogs.push(toDialogDto(dialog));
      }
      return { dialogs };
    }

    case 'getHistory': {
      const chatId = requirePeerId(params.chatId);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offsetId = optionalInt(params.offsetId);
      const offsetDate = optionalInt(params.offsetDate);
      const messages: MessageDto[] = (
        await client.getHistory(
          chatId,
          offsetId !== undefined && offsetDate !== undefined ? { limit, offset: { id: offsetId, date: offsetDate } } : { limit },
        )
      ).map(toMessageDto);
      return { messages };
    }

    case 'sendMessage': {
      const chatId = requirePeerId(params.chatId);
      const text = requireText(params.text);
      return { message: toMessageDto(await client.sendText(chatId, text)) };
    }

    case 'readHistory': {
      const chatId = requirePeerId(params.chatId);
      await client.readHistory(chatId);
      return {};
    }

    case 'searchMessages': {
      const chatId = requirePeerId(params.chatId);
      const query = requireQuery(params.query);
      const limit = clampInt(params.limit, 1, 100, 50);
      const offset = optionalInt(params.offsetId);
      const found = await client.searchMessages({
        chatId,
        query,
        limit,
        ...(offset !== undefined && { offset }),
      });
      return { messages: found.map(toMessageDto), nextOffsetId: found.next };
    }

    default: {
      throw new EngineError(`Unknown RPC method: ${method}`, 404);
    }
  }
}
