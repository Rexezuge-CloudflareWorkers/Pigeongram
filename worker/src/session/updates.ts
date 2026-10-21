import { getMarkedPeerId, Message, MessageReactions, Poll } from '@mtcute/core';
import type { RawUpdateInfo } from '@mtcute/core';
import type { UpdateEvent } from '../types';
import { toMessageDto, toMessageReactionDtos, toPollDto } from './dto';
import { presenceOf } from './presence';

/**
 * Maps the raw updates the engine cares about onto bridge events.
 * Everything else returns `null` (and is only counted for the soak stats).
 */
export function mapRawUpdate(info: RawUpdateInfo): UpdateEvent | null {
  const update = info.update;
  switch (update._) {
    case 'updateNewMessage':
    case 'updateNewChannelMessage': {
      return { type: 'new_message', message: toMessageDto(new Message(update.message, info.peers)) };
    }
    case 'updateEditMessage':
    case 'updateEditChannelMessage': {
      return {
        type: 'edit_message',
        message: toMessageDto(new Message(update.message, info.peers)),
      };
    }
    case 'updateMessageReactions': {
      const chatId = getMarkedPeerId(update.peer);
      const reactions = new MessageReactions(update.msgId, chatId, update.reactions, info.peers);
      return {
        type: 'reactions',
        chatId,
        messageId: update.msgId,
        reactions: toMessageReactionDtos(reactions.reactions),
      };
    }
    case 'updateChannelMessageViews': {
      // Telegram pushes a fresh count to the post's viewers; only channel
      // posts carry views, so the update itself names no peer.
      return {
        type: 'views',
        chatId: getMarkedPeerId(update.channelId, 'channel'),
        messageId: update.id,
        views: update.views,
      };
    }
    case 'updateMessagePoll': {
      return {
        type: 'poll',
        chatId: update.peer ? getMarkedPeerId(update.peer) : null,
        messageId: update.msgId ?? null,
        pollId: update.pollId.toString(),
        // A short update omits the poll body, and mtcute's stand-in for it
        // carries an empty question and no answers; the SPA refetches instead.
        poll: update.poll ? toPollDto(new Poll(update.poll, info.peers, update.results)) : null,
      };
    }
    case 'updateMessagePollVote': {
      // A public poll the account created got a new vote. Telegram names the
      // chat but not the message, so the SPA matches on the poll id.
      return {
        type: 'poll',
        chatId: getMarkedPeerId(update.peer),
        messageId: null,
        pollId: update.pollId.toString(),
        poll: null,
      };
    }
    case 'updateReadHistoryInbox': {
      const peer = info.peers.get(update.peer);
      return {
        type: 'read',
        chatId: peer.id,
        maxId: update.maxId,
        unread: update.stillUnreadCount,
        inbox: true,
      };
    }
    case 'updateReadHistoryOutbox': {
      const peer = info.peers.get(update.peer);
      return { type: 'read', chatId: peer.id, maxId: update.maxId, unread: 0, inbox: false };
    }
    case 'updateReadChannelInbox': {
      return {
        type: 'read',
        chatId: getMarkedPeerId(update.channelId, 'channel'),
        maxId: update.maxId,
        unread: update.stillUnreadCount,
        inbox: true,
      };
    }
    case 'updateReadChannelOutbox': {
      return {
        type: 'read',
        chatId: getMarkedPeerId(update.channelId, 'channel'),
        maxId: update.maxId,
        unread: 0,
        inbox: false,
      };
    }
    case 'updateUserStatus': {
      // A peer came online or went offline. The id is the user's plain id,
      // which is also the marked peer id of a user chat.
      return {
        type: 'user_status',
        userId: update.userId,
        presence: presenceOf(update.status),
      };
    }
    default: {
      return null;
    }
  }
}
