import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * The shared behaviour of the app's menus.
 *
 * Each menu used to carry its own copy of the same six jobs: portal to the
 * body, measure and clamp into the viewport, focus the first item, restore the
 * trigger's focus, close on Escape and on a scroll outside the menu, and close
 * on a press outside it. The copies drifted — the account menu could not close
 * on a sidebar scroll, and the message menu could not restore focus — so the
 * rules live here once and the menus describe only what is inside them.
 */

const MARGIN = 8;
const DEFAULT_ITEM = '[role="menuitem"]:not(:disabled)';

/**
 * Where an open menu wants to sit, before it is clamped into the viewport.
 *
 * A point is the gesture's coordinates (the message menu); a trigger is the
 * control that opened it (the account and thread menus).
 */
export type MenuAnchor = { kind: 'point'; x: number; y: number } | { kind: 'trigger'; rect: DOMRect };

export interface UseAnchoredMenuOptions {
  /**
   * Whether the menu is mounted. Bindings only exist while it is.
   */
  open: boolean;
  /**
   * Closes the menu. A dismiss (Escape, outside press, outside scroll, resize)
   * also returns focus through `returnFocus`.
   */
  onClose: () => void;
  /**
   * Read after every measure: the trigger's rect, or the gesture's point.
   */
  anchor: () => MenuAnchor | null;
  /**
   * Which edge of the trigger the menu lines up with. A point ignores it.
   */
  align?: 'start' | 'end';
  /**
   * The control that opened the menu. A press on it is not "outside": the
   * trigger's own click handler decides whether to close.
   */
  trigger?: RefObject<HTMLElement | null>;
  /**
   * Where focus goes after a dismiss. Menus opened from a gesture leave it
   * unset; menus opened from a button point it at the button.
   */
  returnFocus?: () => void;
  /**
   * What counts as a focusable item, and what the arrow keys cycle.
   */
  itemSelector?: string;
  /**
   * Re-measures when it changes — the reaction picker expanding is the one
   * case. Focus is still only claimed on opening.
   */
  remeasureOn?: unknown;
}

export interface AnchoredMenuState {
  menuRef: RefObject<HTMLDivElement | null>;
  position: CSSProperties;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function useAnchoredMenu(options: UseAnchoredMenuOptions): AnchoredMenuState {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: MARGIN, top: MARGIN });
  const focused = useRef(false);

  /**
   * The latest props, read by the listeners and the measure. They are refs so
   * an inline `anchor`/`onClose` cannot re-run the layout effect (and feed a
   * fresh position back into a render loop), and so the listeners bind once
   * per open instead of once per render.
   */
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  useLayoutEffect(() => {
    if (!options.open) {
      focused.current = false;
      return;
    }
    const menu = menuRef.current;
    const anchor = latest.current.anchor();
    if (menu === null || anchor === null) return;
    const { width, height } = menu.getBoundingClientRect();
    const desired =
      anchor.kind === 'point'
        ? { left: anchor.x, top: anchor.y }
        : {
            left: latest.current.align === 'end' ? anchor.rect.right - width : anchor.rect.left,
            top: anchor.rect.bottom + MARGIN,
          };
    setPosition({
      left: Math.max(MARGIN, Math.min(desired.left, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(desired.top, window.innerHeight - height - MARGIN)),
    });
    // Focus once per opening: re-measuring after the picker expands must not
    // steal focus back from the expand control.
    if (focused.current) {
      return;
    }

    focused.current = true;
    menu.querySelector<HTMLElement>(latest.current.itemSelector ?? DEFAULT_ITEM)?.focus();
  }, [options.open, options.remeasureOn]);

  useEffect(() => {
    if (!options.open) return;
    const dismiss = (): void => {
      latest.current.onClose();
      latest.current.returnFocus?.();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismiss();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (
        !(event.target instanceof Node) ||
        menuRef.current?.contains(event.target) ||
        latest.current.trigger?.current?.contains(event.target)
      )
        return;
      dismiss();
    };
    // The menu is fixed to a point that no longer matches when anything
    // scrolls under it, so any scroll outside its own scrolling region closes
    // it. Capture reaches the thread's scroll container, which never scrolls
    // the window.
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      dismiss();
    };
    const onResize = (): void => dismiss();
    addEventListener('keydown', onKeyDown, { capture: true });
    addEventListener('pointerdown', onPointerDown, { capture: true });
    addEventListener('scroll', onScroll, { capture: true });
    addEventListener('resize', onResize);
    return () => {
      removeEventListener('keydown', onKeyDown, { capture: true });
      removeEventListener('pointerdown', onPointerDown, { capture: true });
      removeEventListener('scroll', onScroll, { capture: true });
      removeEventListener('resize', onResize);
    };
  }, [options.open]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1, latest.current.itemSelector ?? DEFAULT_ITEM);
  }, []);

  return { menuRef, position, onKeyDown };
}

export interface AnchoredMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  position: CSSProperties;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  label: string;
  className?: string;
  id?: string;
  children: ReactNode;
  /**
   * The message menu keeps a right-click inside itself from reaching the
   * bubble's own handler.
   */
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * The portal half: a fixed menu at the hook's clamped position, on the body so
 * no scroll container can clip it.
 */
export function AnchoredMenu({ menuRef, position, onKeyDown, label, className, id, children, onContextMenu }: AnchoredMenuProps) {
  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      className={className}
      style={position}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Cycles focus through the menu's items; the index is taken from the focused
 * item, so opening (first item focused) and tabbing in both wrap sensibly.
 */
function moveFocus(container: HTMLElement, step: number, itemSelector: string): void {
  const items = [...container.querySelectorAll<HTMLElement>(itemSelector)];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[(index + step + items.length) % items.length].focus();
}
