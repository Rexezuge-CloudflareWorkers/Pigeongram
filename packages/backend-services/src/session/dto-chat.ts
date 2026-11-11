import type { Chat, Peer, User } from '@mtcute/core';
import type { ChatDto } from '../types';
import { presenceOfPeer } from './presence';

/**
The chat half of the DTO mapping: a peer as the chat list, the search results
and a thread's header see it, and the two write capabilities the SPA gates its
affordances on.

Split from `dto.ts` to stay under the god-file cap; re-exported there, so every
caller keeps importing `./dto`.
*/

export function toChatDto(peer: Peer): ChatDto {
  const base = {
    id: peer.id,
    title: peer.displayName,
    username: peer.username ?? null,
    photo: photoVersion(peer),
    presence: presenceOfPeer(peer),
  };
  if (peer.type === 'user') {
    return { ...base, kind: peer.isBot ? 'bot' : 'user', canSendMessages: true, canDeleteMessages: false };
  }
  return {
    ...base,
    kind: chatKind(peer),
    canSendMessages: canSendMessages(peer),
    canDeleteMessages: canDeleteMessages(peer),
  };
}

/**
Whether the account may post in a chat.

A chat the account is not in is never writable: a public channel or supergroup
resolved from a link is readable as a preview, but a send there would only
fail. Broadcast channels are admin-only, so the account can post only as the
creator or with the `post_messages` right. Elsewhere a user-specific ban wins,
then the group's default rights bind everyone but admins (a gigagroup is one
whose defaults ban sending outright). An incomplete (`min`) peer carries none
of these flags, so it stays writable rather than guessed at.
*/
function canSendMessages(chat: Chat): boolean {
  if (!chat.isMember) return false;
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
Whether the account may delete other people's messages in a chat.

This gates a destructive call, so it is answered conservatively where sending
is answered optimistically: a chat the account is not in, or an incomplete
(`min`) peer whose rights are unknown, says no. Everywhere else the creator may
delete, and an administrator may when the admin rights carry
`delete_messages` — supergroups and channels carry that right only inside
`adminRights`, while a basic group's administrators can always moderate.
*/
function canDeleteMessages(chat: Chat): boolean {
  if (!chat.isMember || chat.isMin) return false;
  if (chat.isCreator) return true;
  switch (chat.chatType) {
    case 'channel':
    case 'supergroup':
    case 'gigagroup':
    case 'community':
    case 'monoforum': {
      return chat.adminRights?.deleteMessages === true;
    }
    default: {
      // A basic group's administrator may always moderate; the finer
      // `delete_messages` right exists only on channels and supergroups.
      return chat.isAdmin;
    }
  }
}

/**
The avatar's version token, or null when there is no usable photo.

`User.photo` builds an input peer internally and throws for min users and
entities without an access hash, so a missing token is the only safe answer
there — an avatar must never break a dialog or message mapping.
*/
export function photoVersion(peer: User | Chat): string | null {
  try {
    return peer.photo?.small.uniqueFileId ?? null;
  } catch {
    return null;
  }
}

export function chatKind(chat: Chat): ChatDto['kind'] {
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
