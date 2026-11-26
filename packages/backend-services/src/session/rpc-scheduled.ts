import { requireMessageIds, requirePeerId } from './params';
import type { PartialMethodTable } from './rpc-methods';
import { toMessageDto } from './dto';

/**
The scheduled half of the bridge: the queue of messages the account asked
Telegram to send later, and the two writes that act on it.

Scheduled messages are ordinary Telegram messages with a future date, so the
queue is read with `getAllScheduledMessages` and every member crosses the
bridge as the same `MessageDto` a history window carries. The SPA keeps the
queue beside the thread rather than inside its loaded range: a queued message
has no place in the history or the chat list's preview until Telegram sends it.
*/
export const scheduledRpcMethods = {
  getScheduledMessages: {
    readOnly: true,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messages = await context.client.getAllScheduledMessages(chatId);
      return { messages: messages.map(toMessageDto) };
    },
  },

  deleteScheduledMessages: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messageIds = requireMessageIds(params.messageIds);
      await context.client.deleteScheduledMessages(chatId, messageIds);
      return { chatId, messageIds };
    },
  },

  sendScheduled: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const messageIds = requireMessageIds(params.messageIds);
      const sent = await context.client.sendScheduled(chatId, messageIds);
      return { chatId, messageIds, messages: sent.map(toMessageDto) };
    },
  },
} as const satisfies PartialMethodTable;
