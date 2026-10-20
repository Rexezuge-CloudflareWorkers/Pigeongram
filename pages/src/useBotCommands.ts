import { useEffect, useState } from 'react';
import { fetchBotCommands } from './api';
import type { BotCommandDto, ChatDto, PeerId } from './types';

/**
Loads the slash-command menu for the open chat.

Telegram keeps bot commands outside the dialog peer, so they arrive through
their own bridge call when a bot, group or supergroup opens. A failed lookup
is not a thread failure: the composer simply has no menu.
*/
export function useBotCommands(chat: ChatDto | null): readonly BotCommandDto[] {
  const chatId = chat !== null && supportsCommands(chat.kind) ? chat.id : null;
  const [loaded, setLoaded] = useState<{ chatId: PeerId; commands: BotCommandDto[] } | null>(null);

  useEffect(() => {
    if (chatId === null) return;
    let live = true;
    void fetchBotCommands(chatId)
      .then((result) => {
        if (live) setLoaded({ chatId, commands: result.commands });
      })
      .catch(() => {
        if (live) setLoaded({ chatId, commands: [] });
      });
    return () => {
      live = false;
    };
  }, [chatId]);

  // Tagging the result keeps the previous chat's commands from flashing in
  // the composer between the switch and the new answer.
  return loaded !== null && loaded.chatId === chatId ? loaded.commands : NO_COMMANDS;
}

const NO_COMMANDS: readonly BotCommandDto[] = [];

function supportsCommands(kind: ChatDto['kind']): boolean {
  return kind === 'bot' || kind === 'group' || kind === 'supergroup';
}
