import type { MessageReactionDto } from '../types';
import { ALL_REACTIONS, QUICK_REACTIONS, reactionFor } from '../reactions';
import { Icon } from './Icon';

/**
The expanded grid carries the rest of the catalog. The common strip stays
above it, so repeating those emoji here would offer the same reaction twice and
give assistive tech two identically named controls.
*/
const GRID_REACTIONS = ALL_REACTIONS.filter((emoji) => !QUICK_REACTIONS.includes(emoji));

/**
The reaction half of the message context menu: the common strip, the
expand/collapse control, and — once expanded — the complete grid of unicode
reactions Telegram accepts. Picking is the parent's job, so the menu closes and
the thread controller owns the optimistic toggle.

Buttons are menu items so the menu's arrow-key loop and initial focus cover
them without a second navigation model. Reaction items are checkboxes because
they reflect the message's current chosen reaction.
*/
interface ReactionPickerProps {
  /**
  The anchor message's reaction aggregates, used to mark the chosen emoji.
  */
  reactions: readonly MessageReactionDto[];
  /**
  Whether the full grid is shown below the common strip.
  */
  expanded: boolean;
  /**
  Whether a reaction request is in flight; every emoji is disabled then.
  */
  disabled?: boolean;
  /**
  Toggles the full grid. The menu owns the state so it can re-clamp after the
  picker changes its size.
  */
  onToggle: () => void;
  /**
  Sets (or clears) this emoji's reaction on the anchor message.
  */
  onPick: (emoji: string) => void;
}

export function ReactionPicker({ reactions, expanded, disabled = false, onToggle, onPick }: ReactionPickerProps) {
  return (
    <div className="message-menu-reactions">
      <div className="message-menu-quick" role="group" aria-label="Common reactions">
        {QUICK_REACTIONS.map((emoji) => (
          <ReactionOption key={emoji} emoji={emoji} chosen={reactionFor(reactions, emoji).chosen} disabled={disabled} onPick={onPick} />
        ))}
        <button
          type="button"
          role="menuitem"
          className="message-menu-expand"
          data-message-menu-item
          disabled={disabled}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide all reactions' : 'Show all reactions'}
          title={expanded ? 'Hide all reactions' : 'Show all reactions'}
          onClick={onToggle}
        >
          <Icon name={expanded ? 'close' : 'add-reaction'} size={18} />
        </button>
      </div>
      {expanded ? (
        <div className="message-menu-reaction-grid" role="group" aria-label="All reactions">
          {GRID_REACTIONS.map((emoji) => (
            <ReactionOption key={emoji} emoji={emoji} chosen={reactionFor(reactions, emoji).chosen} disabled={disabled} onPick={onPick} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ReactionOptionProps {
  emoji: string;
  chosen: boolean;
  disabled: boolean;
  onPick: (emoji: string) => void;
}

function ReactionOption({ emoji, chosen, disabled, onPick }: ReactionOptionProps) {
  const label = `React with ${emoji}`;
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      className={`message-menu-reaction${chosen ? ' chosen' : ''}`}
      data-message-menu-item
      disabled={disabled}
      aria-checked={chosen}
      aria-label={label}
      title={label}
      onClick={() => onPick(emoji)}
    >
      {emoji}
    </button>
  );
}
