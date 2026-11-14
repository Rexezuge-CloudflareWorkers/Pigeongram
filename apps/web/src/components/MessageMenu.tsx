import { useState } from 'react';
import { downloadMedia, isDownloadable } from '../media-download';
import { reactionFor } from '../reactions';
import type { MessageDto, MessageReactionDto } from '../types';
import { Icon, type IconName } from './Icon';
import { ReactionPicker } from './ReactionPicker';
import { AnchoredMenu, useAnchoredMenu } from './useAnchoredMenu';

/**
The bubble's context menu, opened by a right-click or (on touch) a long press
at the gesture's coordinates. The reaction strip sits above the actions: the
common emoji react directly, and its expand control opens the full picker.
Reply hands the message back to the view that owns the composer target;
Forward hands the whole display group (an album forwards every member) to the
destination picker; Copy Text puts the message's plain text on the clipboard;
Copy Link puts its Telegram address there when the chat has one; Download saves
the message's original media; Delete hands the display group to the confirm
dialog, which deletes it for everyone. Every action carries an icon from the
shared set.
A portal with `position: fixed` keeps the menu out of the scroll container's
clipping, which is also why it closes on any scroll outside itself: a menu
anchored to a moving message would drift. The picker's own grid scrolls without
closing the menu.

An album's menu offers no Download: one click would have to name several
files, so the viewer's per-item download is the album's path. The parent owns
the open/closed state, and every path here closes through `onClose`, so a menu
cannot outlive its message's layout.
*/

interface MessageMenuProps {
  /**
  One display group, oldest first: a standalone message, or an album.
  */
  messages: readonly MessageDto[];
  /**
  Viewport coordinates of the opening gesture.
  */
  x: number;
  y: number;
  /**
  Starts a reply on this message; absent for views that do not reply (the
  comments view's post header).
  */
  onReply?: (message: MessageDto) => void;
  /**
  Starts forwarding this display group; absent for views that do not forward.
  */
  onForward?: (messages: readonly MessageDto[]) => void;
  /**
  Starts editing this message's text; absent for views that do not edit (the
  comments screen's post), for a display group (an album has no single body)
  and for anything the account cannot edit. The row gates those, so a caller
  that passes it always means it.
  */
  onEdit?: (message: MessageDto) => void;
  /**
  Sets (or clears) a reaction on the anchor message; absent for views that do
  not react (a preview chat).
  */
  onReact?: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  Deletes this display group for everyone. Absent where the account may not
  delete it (a preview chat, someone else's message in a chat it does not
  moderate) or where the view does not delete (the comments screen's post).
  */
  onDelete?: (messages: readonly MessageDto[]) => void;
  /**
  Whether a reaction request is in flight; the picker's emoji are disabled.
  */
  reacting?: boolean;
  /**
  The display group's shareable Telegram link, or null when the chat has none
  (a user chat or a basic group). Copy Link appears only with one.
  */
  link?: string | null;
  onClose: () => void;
}

export function MessageMenu({
  messages,
  x,
  y,
  onReply,
  onEdit,
  onForward,
  onReact,
  onDelete,
  reacting = false,
  link = null,
  onClose,
}: MessageMenuProps) {
  const [expanded, setExpanded] = useState(false);
  const { menuRef, position, onKeyDown } = useAnchoredMenu({
    open: true,
    onClose,
    anchor: () => ({ kind: 'point', x, y }),
    itemSelector: '[data-message-menu-item]:not(:disabled)',
    // Expanding the picker changes the menu's size, so the clamp is measured
    // again then.
    remeasureOn: expanded,
  });
  const message = messages[0];
  const canReply = onReply !== undefined && !message.service;
  const canEdit = onEdit !== undefined && messages.length === 1 && !message.service;
  const canForward = onForward !== undefined && !message.service;
  const canCopy = message.text.length > 0;
  const canCopyLink = link !== null;
  const canReact = onReact !== undefined && !message.service;
  const canDelete = onDelete !== undefined && !message.service;
  const canDownload = messages.length === 1 && isDownloadable(message);

  if (!canReply && !canEdit && !canForward && !canCopy && !canCopyLink && !canReact && !canDelete && !canDownload) return null;

  const pickReaction = (emoji: string): void => {
    if (!onReact) return;
    onReact(message, reactionFor(message.reactions, emoji));
    onClose();
  };

  const items: Array<{ label: string; icon: IconName; run: () => void }> = [];
  if (canReply) items.push({ label: 'Reply', icon: 'reply', run: () => onReply?.(message) });
  if (canEdit) items.push({ label: 'Edit', icon: 'edit', run: () => onEdit?.(message) });
  if (canForward) items.push({ label: 'Forward', icon: 'forward', run: () => onForward?.(messages) });
  if (canCopy) items.push({ label: 'Copy Text', icon: 'copy', run: () => void copyToClipboard(message.text) });
  if (link !== null) items.push({ label: 'Copy Link', icon: 'link', run: () => void copyToClipboard(link) });
  if (canDownload) items.push({ label: 'Download', icon: 'download', run: () => downloadMedia(message) });
  if (canDelete) items.push({ label: 'Delete', icon: 'delete', run: () => onDelete?.(messages) });

  return (
    <AnchoredMenu
      menuRef={menuRef}
      position={position}
      onKeyDown={onKeyDown}
      className="message-menu"
      label="Message actions"
      onContextMenu={(event) => {
        // A right-click inside the open menu must not reopen it through the
        // bubble's handler (portal events bubble up the React tree).
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {canReact ? (
        <ReactionPicker
          reactions={message.reactions}
          expanded={expanded}
          disabled={reacting}
          onToggle={() => setExpanded((current) => !current)}
          onPick={pickReaction}
        />
      ) : null}
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="message-menu-item flex items-center gap-2.5"
          data-message-menu-item
          onClick={() => {
            item.run();
            onClose();
          }}
        >
          <Icon name={item.icon} className="text-muted" />
          <span>{item.label}</span>
        </button>
      ))}
    </AnchoredMenu>
  );
}

/**
Best-effort clipboard write; the menu closes either way, and an environment
without the async clipboard API (or a denied permission) simply copies
nothing, like the best-effort read receipts.
*/
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Nothing to surface.
  }
}
