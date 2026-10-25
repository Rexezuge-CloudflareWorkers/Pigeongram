import type { Peer, tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { PresenceDto } from '../types';

/**
 * A peer's presence: the bridge's view of Telegram's online state.
 *
 * Two sources feed it. `contacts.getStatuses` is authoritative for the
 * account's contacts; everyone else carries the state in the `status` field
 * Telegram attaches to the user object, and the `updateUserStatus` pushes
 * report every change that follows.
 *
 * Telegram only says what a peer shares, so a missing state is normal:
 * `null` means "Telegram did not say", never "offline".
 */

/**
 * Maps Telegram's raw status onto the wire shape.
 *
 * The "unknown" status is deliberately not mapped: mtcute would read it as
 * "long ago", which is a claim the bridge cannot make on Telegram's behalf.
 */
export function presenceOf(status: tl.TypeUserStatus | undefined): PresenceDto | null {
  if (!status) return null;
  switch (status._) {
    case 'userStatusOnline': {
      return { status: 'online', lastSeenAt: null };
    }
    case 'userStatusOffline': {
      // Telegram counts the last sighting in seconds.
      return { status: 'offline', lastSeenAt: status.wasOnline * 1000 };
    }
    case 'userStatusRecently': {
      return { status: 'recently', lastSeenAt: null };
    }
    case 'userStatusLastWeek': {
      return { status: 'within_week', lastSeenAt: null };
    }
    case 'userStatusLastMonth': {
      return { status: 'within_month', lastSeenAt: null };
    }
    default: {
      return null;
    }
  }
}

/**
 * The presence Telegram attached to the peer itself.
 *
 * Only a person has one: a bot is never online in the sense the UI shows,
 * and a group or a channel is not a person at all. The account's own row
 * (Saved Messages) is nobody's peer either.
 */
export function presenceOfPeer(peer: Peer): PresenceDto | null {
  if (peer.type !== 'user' || peer.isBot || peer.isSelf) return null;
  return presenceOf(peer.raw.status);
}

/**
 * The presences of the account's contacts, keyed by user id.
 *
 * The method answers with every contact in one round trip, but it is
 * unavailable to bot accounts — and a chat list without presence is far
 * better than no chat list, so an unreadable answer degrades to no presences
 * at all rather than to an error.
 *
 * A contact whose status carries no state is left out of the map, so the
 * state the peer object carried stays in place.
 */
export async function readContactPresences(client: TelegramClient): Promise<Map<number, PresenceDto>> {
  try {
    const statuses = await client.call({ _: 'contacts.getStatuses' });
    const byUser = new Map<number, PresenceDto>();
    for (const entry of statuses) {
      const presence = presenceOf(entry.status);
      if (presence) byUser.set(entry.userId, presence);
    }
    return byUser;
  } catch {
    return new Map();
  }
}
