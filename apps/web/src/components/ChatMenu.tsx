import type { DialogDto, PeerId } from '../types';
import { Icon } from './Icon';
import { AnchoredMenu, useAnchoredMenu } from './useAnchoredMenu';

/**
 * The chat list's context menu: right-click a row, or hold it on touch, for the
 * actions that belong to the whole chat. Mark As Read clears an unread badge
 * without opening the chat; an already-read chat greys it out, because the
 * action would have nothing left to settle.
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
  onClose: () => void;
}

export function ChatMenu({ dialog, x, y, onMarkRead, onClose }: ChatMenuProps) {
  const { menuRef, position, onKeyDown } = useAnchoredMenu({
    open: true,
    onClose,
    anchor: () => ({ kind: 'point', x, y }),
    itemSelector: '[data-chat-menu-item]:not(:disabled)',
  });

  return (
    <AnchoredMenu
      menuRef={menuRef}
      position={position}
      onKeyDown={onKeyDown}
      className="fixed z-40 min-w-[180px] rounded-xl border border-line bg-panel-2 p-1 shadow-2xl"
      label="Chat actions"
      onContextMenu={(event) => {
        // A right-click inside the open menu must not reopen it through the
        // row's handler (portal events bubble up the React tree).
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        role="menuitem"
        className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none disabled:cursor-default disabled:opacity-40"
        data-chat-menu-item
        disabled={dialog.unread === 0}
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
