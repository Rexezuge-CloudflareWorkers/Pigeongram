import type { BotCommandDto } from '../types';

/**
The slash-command listbox: the filtered commands and the one the keyboard has
highlighted. It owns no state — the composer keeps the query, the highlight and
the dismissal — so the menu is a render of what the textarea's keys act on.
*/
interface CommandMenuProps {
  /**
  The id the textarea's `aria-controls` points at; option ids extend it.
  */
  id: string;
  commands: readonly BotCommandDto[];
  active: number;
  onActive: (index: number) => void;
  onPick: (command: BotCommandDto) => void;
}

export function CommandMenu({ id, commands, active, onActive, onPick }: CommandMenuProps) {
  return (
    <div className="command-menu" id={id} role="listbox" aria-label="Bot Commands">
      {commands.map((command, index) => (
        <button
          key={command.command}
          id={`${id}-${index}`}
          type="button"
          role="option"
          aria-selected={index === active}
          className={index === active ? 'active' : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onActive(index)}
          onClick={() => onPick(command)}
        >
          <span className="command-name">/{command.command}</span>
          {command.description ? <span className="command-description">{command.description}</span> : null}
        </button>
      ))}
    </div>
  );
}
