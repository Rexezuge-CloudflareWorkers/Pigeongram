import type { Chat, Dialog, Message, Peer, User } from '@mtcute/core';
import type { ChatDto, DialogDto, MeDto, MessageDto } from '../types';

/**
Converts mtcute's high-level objects into the bridge's JSON DTOs.
*/

export function toMeDto(user: User): MeDto {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName ?? null,
    username: user.username ?? null,
    phone: user.raw.phone ?? null,
  };
}

export function toChatDto(peer: Peer): ChatDto {
  if (peer.type === 'user') {
    return {
      id: peer.id,
      kind: peer.isBot ? 'bot' : 'user',
      title: peer.displayName,
      username: peer.username ?? null,
    };
  }
  return {
    id: peer.id,
    kind: chatKind(peer),
    title: peer.displayName,
    username: peer.username ?? null,
  };
}

function chatKind(chat: Chat): ChatDto['kind'] {
  switch (chat.chatType) {
    case 'group': {
      return 'group';
    }
    case 'channel':
    case 'monoforum': {
      return 'channel';
    }
    default: {
      // `supergroup`, `gigagroup` and `community` are all supergroups to the UI.
      return 'supergroup';
    }
  }
}

export function toMessageDto(message: Message): MessageDto {
  // `sender` is typed as `Peer`, but service messages from anonymous admins
  // carry a sender without an id; guard at runtime instead of trusting the
  // nominal type.
  const sender = message.sender as { id?: number; displayName?: string } | null;
  return {
    id: message.id,
    chatId: message.chat.id,
    senderId: typeof sender?.id === 'number' ? sender.id : null,
    senderName: sender?.displayName ?? null,
    outgoing: message.isOutgoing,
    date: message.date.getTime(),
    text: message.text,
    service: message.isService,
    photo: message.media?.type === 'photo',
  };
}

export function toDialogDto(dialog: Dialog): DialogDto {
  return {
    chat: toChatDto(dialog.peer),
    lastMessage: dialog.lastMessage ? toMessageDto(dialog.lastMessage) : null,
    unread: dialog.unreadCount,
    pinned: dialog.isPinned,
    muted: dialog.isMuted === true,
  };
}
