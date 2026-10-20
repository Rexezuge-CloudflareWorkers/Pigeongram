import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { BotCommandDto } from '../types';

/**
Reads the slash-command menu of a chat.

Telegram does not put commands on the dialog peer: a bot's commands live in
the full user (`userFull.botInfo.commands`), and a group or channel carries
them per bot in `botInfo[]`. Commands are ordered as Telegram sent them and
de-duplicated by name, because several bots in one group may register the
same command.
*/
export async function readBotCommands(client: TelegramClient, chatId: number): Promise<BotCommandDto[]> {
  if (chatId > 0) {
    return toCommandDtos([(await client.getFullUser(chatId)).full.botInfo]);
  }
  const { full } = await client.getFullChat(chatId);
  // `chatFull`/`channelFull` carry bot commands; `communityFull` does not.
  return toCommandDtos('botInfo' in full ? (full.botInfo ?? []) : []);
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
