import type { BotCommandDto } from './types';

/**
The filter text when the draft is a bare slash prefix, or null when it is
anything else. Commands are only recognized at the start of a message, so a
slash in running text does not open the menu.
*/
export function slashQuery(text: string): string | null {
  const match = /^\/(\w*)$/.exec(text);
  return match === null ? null : match[1];
}

export function filterCommands(commands: readonly BotCommandDto[], query: string): readonly BotCommandDto[] {
  if (query === '') return commands;
  const needle = query.toLowerCase();
  return commands.filter((command) => command.command.toLowerCase().startsWith(needle));
}
