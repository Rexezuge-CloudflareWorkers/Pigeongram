import { Icon } from './Icon';

interface ArchiveBarProps {
  /**
  How many chats the archive holds.
  */
  count: number;
  /**
  Leaves the archive for the chat list.
  */
  onBack: () => void;
}

/**
The archive's header: the screen's name and the way back to the chat list.

The archive is a screen of its own (`/archived`), so the sidebar says what it
is showing — otherwise the list below would look like the chat list with fewer
chats in it.
*/
export function ArchiveBar({ count, onBack }: ArchiveBarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to chats"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Icon name="arrow-left" />
      </button>
      <strong className="min-w-0 truncate text-sm">Archived Chats</strong>
      <span className="ml-auto shrink-0 text-xs text-muted">{count}</span>
    </div>
  );
}
