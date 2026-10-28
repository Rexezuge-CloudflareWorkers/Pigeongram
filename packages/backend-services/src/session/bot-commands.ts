import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { BotCommandDto } from '../types';

/**
 * Reads the menu a chat shows beside its composer.
 *
 * Telegram keeps two things on the full peer: the slash-command menu and the
 * text an empty chat introduces itself with. A bot's commands live in the full
 * user (`userFull.botInfo.commands`), and a group or channel carries them per
 * bot in `botInfo[]`. The empty-chat text is the bot's own description, or a
 * chat's bio; one full-peer read therefore answers both.
 *
 * Commands are ordered as Telegram sent them and de-duplicated by name, because
 * several bots in one group may register the same command.
 *
 * `peer` is the input peer when the caller already holds it — the discussion
 * group resolved from a channel post — so the read does not resolve the chat a
 * second time.
 */

export interface ChatMenu {
  commands: BotCommandDto[];
  /**
   * The text Telegram shows in a chat with no messages: a bot's own
   * description, or a group's or channel's description. Null when it has none.
   */
  description: string | null;
}

export async function readChatMenu(client: TelegramClient, chatId: number, peer?: tl.TypeInputPeer): Promise<ChatMenu> {
  if (chatId > 0) {
    const full = await client.getFullUser(peer ?? chatId);
    return {
      commands: toCommandDtos([full.full.botInfo]),
      // The empty-chat introduction is the bot's description, which Telegram
      // keeps apart from the profile's bio. Fall back to the bio when the bot
      // never set one, so an empty chat is not left blank for no reason.
      description: full.full.botInfo?.description || full.bio || null,
    };
  }
  const { full } = await client.getFullChat(peer ?? chatId);
  return {
    // `chatFull`/`channelFull` carry bot commands; `communityFull` does not.
    commands: toCommandDtos('botInfo' in full ? (full.botInfo ?? []) : []),
    description: full.about || null,
  };
}

function toCommandDtos(infos: readonly (tl.TypeBotInfo | undefined)[]): BotCommandDto[] {
  const commands: BotCommandDto[] = [];
  const seen = new Set<string>();
  for (const info of infos) {
    for (const command of info?.commands ?? []) {
      const name = command.command.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      commands.push({ command: name, description: command.description });
    }
  }
  return commands;
}
