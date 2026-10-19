import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MessageDto } from '../types';

/**
The bubble's context menu, opened by a right-click or (on touch) a long press
at the gesture's coordinates. Reply hands the message back to the view that
owns the composer target; Copy text puts the message's plain text on the
clipboard. A portal with `position: fixed` keeps the menu out of the scroll
container's clipping, which is also why it closes on any scroll: a menu
anchored to a moving message would drift.

The parent owns the open/closed state, and every path here closes through
`onClose`, so a menu cannot outlive its message's layout.
*/

interface MessageMenuProps {
  message: MessageDto;
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
  onClose: () => void;
}

export function MessageMenu({ message, x, y, onReply, onClose }: MessageMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const canReply = onReply !== undefined && !message.service;
  const canCopy = message.text.length > 0;

  // Clamp the menu into the viewport once its real size is known (the first
  // paint at the raw cursor keeps the open instant), and focus the first item
  // so the keyboard can drive it — the Menu key opens the menu focused.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onClose();
    };
    // Capture, so Escape lands before any other key handler acts and a press
    // anywhere (including another bubble's) closes this menu first. The
    // thread scrolls inside its own container, not the window, so that too is
    // caught on the way down.
    addEventListener('keydown', onKeyDown, { capture: true });
    addEventListener('pointerdown', onPointerDown, { capture: true });
    addEventListener('scroll', onClose, { capture: true });
    addEventListener('resize', onClose);
    return () => {
      removeEventListener('keydown', onKeyDown, { capture: true });
      removeEventListener('pointerdown', onPointerDown, { capture: true });
      removeEventListener('scroll', onClose, { capture: true });
      removeEventListener('resize', onClose);
    };
  }, [onClose]);

  if (!canReply && !canCopy) return null;

  const items: Array<{ label: string; run: () => void }> = [];
  if (canReply) items.push({ label: 'Reply', run: () => onReply?.(message) });
  if (canCopy) items.push({ label: 'Copy text', run: () => void copyText(message.text) });

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
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="message-menu-item"
          onClick={() => {
            item.run();
            onClose();
          }}
        >
          {item.label}
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
  const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[(index + step + items.length) % items.length].focus();
}

/**
Best-effort clipboard write; the menu closes either way, and an environment
without the async clipboard API (or a denied permission) simply copies
nothing, like the best-effort read receipts.
*/
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Nothing to surface.
  }
}
