import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadMedia, isDownloadable } from '../media-download';
import { reactionFor } from '../reactions';
import type { MessageDto, MessageReactionDto } from '../types';
import { Icon, type IconName } from './Icon';
import { ReactionPicker } from './ReactionPicker';

/**
The bubble's context menu, opened by a right-click or (on touch) a long press
at the gesture's coordinates. The reaction strip sits above the actions: the
common emoji react directly, and its expand control opens the full picker.
Reply hands the message back to the view that owns the composer target;
Forward hands the whole display group (an album forwards every member) to the
destination picker; Copy Text puts the message's plain text on the clipboard;
Copy Link puts its Telegram address there when the chat has one; Download saves
the message's original media. Every action carries an icon from the shared set.
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
  Sets (or clears) a reaction on the anchor message; absent for views that do
  not react (the comments view's post header).
  */
  onReact?: (message: MessageDto, reaction: MessageReactionDto) => void;
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

export function MessageMenu({ messages, x, y, onReply, onForward, onReact, reacting = false, link = null, onClose }: MessageMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [expanded, setExpanded] = useState(false);
  const message = messages[0];
  const canReply = onReply !== undefined && !message.service;
  const canForward = onForward !== undefined && !message.service;
  const canCopy = message.text.length > 0;
  const canCopyLink = link !== null;
  const canReact = onReact !== undefined && !message.service;
  const canDownload = messages.length === 1 && isDownloadable(message);

  // Clamp the menu into the viewport once its real size is known (the first
  // paint at the raw cursor keeps the open instant). Expanding the picker
  // changes that size, so it is measured again then.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
  }, [x, y, expanded]);

  // Focus the first control once, so the keyboard can drive the menu — the
  // Menu key opens it focused. Re-clamping on expand must not steal focus
  // back from the expand button.
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-message-menu-item]:not(:disabled)')?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onClose();
    };
    const onScroll = (event: Event): void => {
      // The all-reactions grid scrolls inside the menu; a scroll anchored to
      // a moving message outside it closes the menu instead.
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onClose();
    };
    // Capture, so Escape lands before any other key handler acts and a press
    // anywhere (including another bubble's) closes this menu first. The
    // thread scrolls inside its own container, not the window, so that too is
    // caught on the way down.
    addEventListener('keydown', onKeyDown, { capture: true });
    addEventListener('pointerdown', onPointerDown, { capture: true });
    addEventListener('scroll', onScroll, { capture: true });
    addEventListener('resize', onClose);
    return () => {
      removeEventListener('keydown', onKeyDown, { capture: true });
      removeEventListener('pointerdown', onPointerDown, { capture: true });
      removeEventListener('scroll', onScroll, { capture: true });
      removeEventListener('resize', onClose);
    };
  }, [onClose]);

  if (!canReply && !canForward && !canCopy && !canCopyLink && !canReact && !canDownload) return null;

  const pickReaction = (emoji: string): void => {
    if (!onReact) return;
    onReact(message, reactionFor(message.reactions, emoji));
    onClose();
  };

  const items: Array<{ label: string; icon: IconName; run: () => void }> = [];
  if (canReply) items.push({ label: 'Reply', icon: 'reply', run: () => onReply?.(message) });
  if (canForward) items.push({ label: 'Forward', icon: 'forward', run: () => onForward?.(messages) });
  if (canCopy) items.push({ label: 'Copy Text', icon: 'copy', run: () => void copyToClipboard(message.text) });
  if (link !== null) items.push({ label: 'Copy Link', icon: 'link', run: () => void copyToClipboard(link) });
  if (canDownload) items.push({ label: 'Download', icon: 'download', run: () => downloadMedia(message) });

  return createPortal(
    <div
      ref={ref}
      className="message-menu"
      role="menu"
      aria-label="Message actions"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => {
        // A right-click inside the open menu must not reopen it through the
        // bubble's handler (portal events bubble up the React tree).
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') moveFocus(event.currentTarget, 1);
        else if (event.key === 'ArrowUp') moveFocus(event.currentTarget, -1);
        else return;
        event.preventDefault();
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
    </div>,
    document.body,
  );
}

/**
Cycles focus through the menu's items; the index is taken from the focused
item, so opening (first item focused) and tabbing in both wrap sensibly.
*/
function moveFocus(container: HTMLElement, step: number): void {
  const items = [...container.querySelectorAll<HTMLElement>('[data-message-menu-item]:not(:disabled)')];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[(index + step + items.length) % items.length].focus();
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
