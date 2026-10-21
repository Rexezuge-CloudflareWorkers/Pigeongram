import type { Chat, Dialog, Message, MessageEntity, MessageMedia, Peer, Poll, ReactionCount, User } from '@mtcute/core';
import { serviceText } from './service-text';
import { toMessageMarkupDto } from './markup';
import { presenceOfPeer } from './presence';
import type {
  ChatDto,
  DialogDto,
  MeDto,
  MessageCommentsDto,
  MessageDto,
  MessageEntityDto,
  MessageForwardDto,
  MessageMediaDto,
  MessagePollDto,
  MessageReactionDto,
  MessageReplyDto,
} from '../types';

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
    presence: presenceOfPeer(peer),
  };
  if (peer.type === 'user') {
    return { ...base, kind: peer.isBot ? 'bot' : 'user', canSendMessages: true };
  }
  return { ...base, kind: chatKind(peer), canSendMessages: canSendMessages(peer) };
}

/**
Whether the account may post in a chat.

Broadcast channels are admin-only, so the account can post only as the
creator or with the `post_messages` right. Elsewhere a user-specific ban
wins, then the group's default rights bind everyone but admins (a gigagroup
is one whose defaults ban sending outright). An incomplete (`min`) peer
carries none of these flags, so it stays writable rather than guessed at.
*/
function canSendMessages(chat: Chat): boolean {
  if (chat.isMin) return true;
  if (chat.permissions && !chat.permissions.canSendMessages) return false;
  switch (chat.chatType) {
    case 'channel': {
      return chat.isCreator || chat.adminRights?.postMessages === true;
    }
    case 'monoforum': {
      // The channel's direct-message space: any subscriber may write.
      return true;
    }
    default: {
      return chat.isAdmin || !chat.defaultPermissions || chat.defaultPermissions.canSendMessages;
    }
  }
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

/**
Maps mtcute's reply header onto the wire shape.

A same-chat header carries only the replied-to message id, so the SPA
resolves sender and snippet from the thread it already has; cross-chat
headers carry sender/date/media instead.
*/
function toMessageReplyDto(message: Message): MessageReplyDto | null {
  const reply = message.replyToMessage;
  if (!reply) return null;
  const sender = reply.sender;
  // The getter is typed non-null but returns null whenever the header has no
  // media (which is the common case for same-chat replies).
  const media = reply.media;
  return {
    origin: reply.origin,
    messageId: reply.id,
    chatId: reply.chat?.id ?? null,
    senderName: sender?.displayName ?? null,
    date: reply.date?.getTime() ?? null,
    text: reply.quoteText,
    entities: reply.quoteEntities.map(toMessageEntityDto),
    mediaKind: media ? (toMessageMediaDto(media)?.kind ?? null) : null,
    // The getter is typed `boolean` but passes the raw optional flag through.
    quote: reply.isQuote ?? false,
  };
}

/**
Maps the `replies` header of a channel post onto the wire shape: the flag and
count the UI renders, plus the linked discussion group the thread lives in.
*/
function toMessageCommentsDto(message: Message): MessageCommentsDto | null {
  const replies = message.replies;
  if (!replies) return null;
  return {
    hasComments: replies.hasComments,
    count: replies.count,
    discussionChatId: replies.discussion,
  };
}

/**
Maps mtcute's forward header onto the wire shape.

The origin may be a user, the channel whose post was forwarded, or a hidden
sender whose name rides in `fromName` instead of an id; saved-messages
forwards additionally name the original chat and message.
*/
function toMessageForwardDto(message: Message): MessageForwardDto | null {
  const forward = message.forward;
  if (!forward) return null;
  // `sender` is typed `PeerSender`, but the getter throws when a header
  // carries neither `fromId` nor `fromName`; the date alone is still worth
  // showing, so a malformed header keeps the forward without a name.
  let sender: { id?: number; displayName?: string; username?: string | null } | null = null;
  try {
    sender = forward.sender;
  } catch {
    // Fall through with a null sender.
  }
  return {
    senderId: typeof sender?.id === 'number' ? sender.id : null,
    senderName: sender?.displayName ?? null,
    senderUsername: sender?.username ?? null,
    date: forward.date.getTime(),
    fromChatId: forward.fromChat()?.id ?? null,
    // mtcute's getter only reads `savedFromMsgId`; a direct channel forward
    // carries the original id in `channelPost` instead.
    fromMessageId: forward.raw.channelPost ?? forward.fromMessageId,
    signature: forward.signature,
  };
}

export function toMessageDto(message: Message): MessageDto {
  // `sender` is typed as `Peer`, but service messages from anonymous admins
  // carry a sender without an id; guard at runtime instead of trusting the
  // nominal type. `photoVersion` catches the other unusable senders (min
  // users, missing access hashes) and degrades to the initials fallback.
  const sender = message.sender as Peer | null;
  const senderName = sender?.displayName ?? null;
  const media = message.media;
  return {
    id: message.id,
    chatId: message.chat.id,
    groupedId: message.groupedId?.toString() ?? null,
    senderId: typeof sender?.id === 'number' ? sender.id : null,
    senderName,
    senderPhoto: sender === null ? null : photoVersion(sender),
    outgoing: message.isOutgoing,
    date: message.date.getTime(),
    text: message.isService ? serviceText(message, senderName) : message.text,
    entities: message.entities.map(toMessageEntityDto),
    reactions: toMessageReactionDtos(message.reactions?.reactions ?? []),
    service: message.isService,
    media: toMessageMediaDto(media),
    poll: media?.type === 'poll' ? toPollDto(media) : null,
    markup: toMessageMarkupDto(message),
    reply: toMessageReplyDto(message),
    forward: toMessageForwardDto(message),
    views: message.views,
    comments: toMessageCommentsDto(message),
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
    case 'sticker': {
      // A sticker's dimensions let the bubble reserve its box before the webp
      // loads, the same way a photo's do (mtcute defaults to 512×512).
      return {
        kind: 'sticker',
        fileName: media.fileName,
        mime: media.mimeType,
        size: media.raw.size,
        width: media.width,
        height: media.height,
        duration: null,
      };
    }
    case 'document': {
      return {
        kind: 'document',
        fileName: media.fileName,
        mime: media.mimeType,
        size: media.raw.size,
        width: null,
        height: null,
        duration: null,
      };
    }
    default: {
      // Geo points, contacts, games and other non-file media stay text-only
      // in the UI; polls ride beside `media` through `toPollDto`.
      return null;
    }
  }
}

/**
Maps mtcute's poll media onto the wire shape.

`voters`/`correct` are only carried when Telegram sent results with the poll:
a quiz before this account answers, or a poll that hides its results until the
close, arrives without them, and mtcute's getters would quietly answer zero
and false for that case.
*/
export function toPollDto(poll: Poll): MessagePollDto {
  const results = poll.results;
  return {
    id: poll.id.toString(),
    question: poll.question,
    answers: poll.answers.map((answer) => ({
      text: answer.text,
      voters: results ? answer.voters : null,
      chosen: answer.chosen,
      // The TL flag only means anything for quizzes; a plain poll would
      // otherwise report every answer as not-correct.
      correct: results && poll.isQuiz ? answer.correct : null,
    })),
    totalVoters: results?.totalVoters ?? null,
    // The raw TL flags are optional and come through as `undefined`; the
    // getters' boolean signatures hide that, and the DTO wants a real boolean.
    closed: poll.raw.closed === true,
    quiz: poll.raw.quiz === true,
    multiple: poll.raw.multipleChoice === true,
    revotingDisabled: poll.raw.revotingDisabled === true,
    hideResultsUntilClose: poll.raw.hideResultsUntilClose === true,
    solution: poll.solution,
  };
}

export function toDialogDto(dialog: Dialog): DialogDto {
  return {
    chat: toChatDto(dialog.peer),
    lastMessage: dialog.lastMessage ? toMessageDto(dialog.lastMessage) : null,
    unread: dialog.unreadCount,
    // The raw fields are optional even though mtcute's getters are typed as
    // numbers; a dialog that never carried them has read nothing.
    readInboxMaxId: dialog.lastReadIngoing ?? 0,
    readOutboxMaxId: dialog.lastReadOutgoing ?? 0,
    pinned: dialog.isPinned,
    muted: dialog.isMuted === true,
  };
}
