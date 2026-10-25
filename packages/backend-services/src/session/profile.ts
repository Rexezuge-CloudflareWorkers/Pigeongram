import type { TelegramClient } from '@mtcute/core/client.js';
import type { ProfileDto } from '../types';
import { chatKind, photoVersion } from './dto';
import { EngineError } from './errors';

/**
 * Reads a peer's profile.
 *
 * The chat list carries a peer's name and its handle; the profile is what the
 * list has no room for. A person's is a bio, a group's or a channel's is a
 * description and a member count, so one read covers both kinds of peer.
 *
 * Telegram splits the answer in two, exactly as the slash-command menu does:
 * a person is read from the full user, a chat from the full chat. The marked
 * peer id says which one it is — a user is positive, a chat negative.
 */
export async function readProfile(client: TelegramClient, chatId: number): Promise<ProfileDto> {
  if (chatId > 0) {
    return readUserProfile(client, chatId);
  }
  return readChatProfile(client, chatId);
}

/**
 * Reads a person's profile: their name, their handle and their bio.
 *
 * A bot's own description stands in for the bio, which a bot usually leaves
 * empty — the description is what the bot tells the world about itself.
 */
async function readUserProfile(client: TelegramClient, chatId: number): Promise<ProfileDto> {
  const full = await client.getFullUser(chatId).catch(() => null);
  if (!full) throw new EngineError('Peer not found', 404);
  return {
    id: full.id,
    kind: full.isBot ? 'bot' : 'user',
    title: full.displayName,
    username: full.username ?? null,
    about: full.bio || full.full.botInfo?.description || null,
    photo: photoVersion(full),
    membersCount: null,
  };
}

/**
 * Reads a chat's profile: its title, its handle and its description.
 *
 * Telegram counts the members of a channel and a supergroup, but not those of
 * a basic group, so an uncounted chat reports no number at all rather than a
 * wrong one.
 */
async function readChatProfile(client: TelegramClient, chatId: number): Promise<ProfileDto> {
  const full = await client.getFullChat(chatId).catch(() => null);
  if (!full) throw new EngineError('Peer not found', 404);
  const membersCount = full.membersCount;
  return {
    id: full.id,
    kind: chatKind(full),
    title: full.title,
    username: full.username ?? null,
    about: full.bio || null,
    photo: photoVersion(full),
    membersCount: membersCount > 0 ? membersCount : null,
  };
}
