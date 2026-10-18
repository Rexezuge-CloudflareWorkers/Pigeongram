import type { Chat, Dialog, Message, MessageEntity, MessageMedia, Peer, ReactionCount, User } from '@mtcute/core';
import type { ChatDto, DialogDto, MeDto, MessageDto, MessageEntityDto, MessageMediaDto, MessageReactionDto } from '../types';

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
    photo: photoVersion(user),
  };
}

export function toChatDto(peer: Peer): ChatDto {
  const base = {
    id: peer.id,
    title: peer.displayName,
    username: peer.username ?? null,
    photo: photoVersion(peer),
  };
  if (peer.type === 'user') {
    return { ...base, kind: peer.isBot ? 'bot' : 'user' };
  }
  return { ...base, kind: chatKind(peer) };
}

/**
The avatar's version token, or null when there is no usable photo.

`User.photo` builds an input peer internally and throws for min users and
entities without an access hash, so a missing token is the only safe answer
there — an avatar must never break a dialog or message mapping.
*/
function photoVersion(peer: User | Chat): string | null {
  try {
    return peer.photo?.small.uniqueFileId ?? null;
  } catch {
    return null;
  }
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

function toMessageEntityDto(entity: MessageEntity): MessageEntityDto {
  const params = entity.params;
  const dto: MessageEntityDto = {
    offset: entity.offset,
    length: entity.length,
    kind: entity.kind,
  };
  if (params.kind === 'text_link') dto.url = params.url;
  if (params.kind === 'pre' && params.language !== undefined) dto.language = params.language;
  if (params.kind === 'text_mention') dto.userId = params.userId;
  return dto;
}

/**
Maps mtcute's reaction aggregates onto the wire shape. Custom emoji carry
their document id as a decimal string (a `Long` has no JSON representation).
*/
export function toMessageReactionDtos(reactions: readonly ReactionCount[]): MessageReactionDto[] {
  return reactions.map((reaction) => {
    const emoji = reaction.emoji;
    return {
      emoji: typeof emoji === 'string' ? emoji : null,
      customEmojiId: typeof emoji === 'string' ? null : emoji.toString(),
      count: reaction.count,
      chosen: reaction.order !== null,
    };
  });
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
    entities: message.entities.map(toMessageEntityDto),
    reactions: toMessageReactionDtos(message.reactions?.reactions ?? []),
    service: message.isService,
    media: toMessageMediaDto(message.media),
  };
}

function toMessageMediaDto(media: MessageMedia): MessageMediaDto | null {
  if (!media) return null;
  switch (media.type) {
    case 'photo': {
      return {
        kind: 'photo',
        fileName: null,
        mime: null,
        size: media.fileSize ?? null,
        width: media.width,
        height: media.height,
        duration: null,
      };
    }
    case 'video': {
      return {
        kind: media.isAnimation ? 'animation' : 'video',
        fileName: media.fileName,
        mime: media.mimeType,
        size: media.raw.size,
        width: media.width,
        height: media.height,
        duration: media.duration,
      };
    }
    case 'audio':
    case 'voice': {
      return {
        kind: media.type,
        fileName: media.fileName,
        mime: media.mimeType,
        size: media.raw.size,
        width: null,
        height: null,
        duration: media.duration,
      };
    }
    case 'sticker':
    case 'document': {
      return {
        kind: media.type,
        fileName: media.fileName,
        mime: media.mimeType,
        size: media.raw.size,
        width: null,
        height: null,
        duration: null,
      };
    }
    default: {
      // Polls, geo points and other non-file media stay text-only in the UI.
      return null;
    }
  }
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
