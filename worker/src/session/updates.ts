import { getMarkedPeerId, Message } from '@mtcute/core';
import type { RawUpdateInfo } from '@mtcute/core';
import type { UpdateEvent } from '../types';
import { toMessageDto } from './dto';

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
    case 'updateReadHistoryInbox': {
      const peer = info.peers.get(update.peer);
      return {
        type: 'read',
        chatId: peer.id,
        maxId: update.maxId,
        unread: update.stillUnreadCount,
      };
    }
    case 'updateReadHistoryOutbox': {
      const peer = info.peers.get(update.peer);
      return { type: 'read', chatId: peer.id, maxId: update.maxId, unread: 0 };
    }
    case 'updateReadChannelInbox': {
      return {
        type: 'read',
        chatId: getMarkedPeerId(update.channelId, 'channel'),
        maxId: update.maxId,
        unread: update.stillUnreadCount,
      };
    }
    case 'updateReadChannelOutbox': {
      return {
        type: 'read',
        chatId: getMarkedPeerId(update.channelId, 'channel'),
        maxId: update.maxId,
        unread: 0,
      };
    }
    default: {
      return null;
    }
  }
}
