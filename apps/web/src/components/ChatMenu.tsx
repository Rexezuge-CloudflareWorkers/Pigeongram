import type { DialogDto, PeerId } from '../types';
import { Icon } from './Icon';
import { AnchoredMenu, useAnchoredMenu } from './useAnchoredMenu';

/**
 * The chat list's context menu: right-click a row, or hold it on touch, for the
 * actions that belong to the whole chat. Pin moves the chat into the pinned
 * block (or Unpin drops it back into the activity order); Mark As Read clears
 * an unread badge without opening the chat, and an already-read chat greys it
 * out because the action would have nothing left to settle.
 */

interface ChatMenuProps {
  /**
   * The chat the menu was opened on, as it stood at the gesture.
   */
  dialog: DialogDto;
  /**
   * Viewport coordinates of the opening gesture.
   */
  x: number;
  y: number;
  onMarkRead: (chatId: PeerId) => void;
  /**
   * Pins or unpins the chat in its list; absent where the list cannot write.
   */
  onSetPinned?: (chatId: PeerId, pinned: boolean) => void;
  onClose: () => void;
}

export function ChatMenu({ dialog, x, y, onMarkRead, onSetPinned, onClose }: ChatMenuProps) {
  const { menuRef, position, onKeyDown } = useAnchoredMenu({
    open: true,
    onClose,
    anchor: () => ({ kind: 'point', x, y }),
    itemSelector: '[data-chat-menu-item]:not(:disabled)',
  });
  const read = dialog.unread === 0;

  return (
    <AnchoredMenu
      menuRef={menuRef}
      position={position}
      onKeyDown={onKeyDown}
      className="min-w-[180px] p-1"
      label="Chat actions"
      onContextMenu={(event) => {
        // A right-click inside the open menu must not reopen it through the
        // row's handler (portal events bubble up the React tree).
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {onSetPinned ? (
        <button
          type="button"
          role="menuitem"
          className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-chat-menu-item
          onClick={() => {
            onSetPinned(dialog.chat.id, !dialog.pinned);
            onClose();
          }}
        >
          <Icon name="pin" className="text-muted" size={18} />
          <span>{dialog.pinned ? 'Unpin' : 'Pin'}</span>
        </button>
      ) : null}
      {/* The read state is explained inline, so the disabled control is never
          a dead end: a reader who finds it greys out learns the chat is
          already read. */}
      {read ? (
        <span role="status" className="block px-3 pt-2 pb-1 text-xs text-muted">
          Already Read
        </span>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40"
        data-chat-menu-item
        disabled={read}
        title={read ? 'Already read' : undefined}
        aria-disabled={read}
        onClick={() => {
          onMarkRead(dialog.chat.id);
          onClose();
        }}
      >
        <Icon name="done-all" className="text-muted" size={18} />
        <span>Mark As Read</span>
      </button>
    </AnchoredMenu>
  );
}
