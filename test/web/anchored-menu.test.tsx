import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { MenuAnchor, UseAnchoredMenuOptions } from '../../apps/web/src/components/useAnchoredMenu';
import { AnchoredMenu, useAnchoredMenu } from '../../apps/web/src/components/useAnchoredMenu';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The menu hook's shared rules.
 *
 * The three menus used to carry a copy of this behaviour each; these tests
 * pin the rules themselves — the portal, the clamp, the first-item focus, the
 * focus return and the three ways a menu goes away — so a later menu gets the
 * same behaviour by using the hook rather than by copying it again.
 */

interface HarnessProps {
  initialOpen?: boolean;
  anchor?: 'point' | 'trigger';
  align?: 'start' | 'end';
  remeasureOn?: unknown;
}

function Harness({ initialOpen = true, anchor = 'point', align, remeasureOn }: HarnessProps) {
  const [open, setOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, position, onKeyDown } = useAnchoredMenu({
    open,
    onClose: () => setOpen(false),
    anchor: (): MenuAnchor | null =>
      anchor === 'point'
        ? { kind: 'point', x: 100, y: 120 }
        : triggerRef.current
          ? { kind: 'trigger', rect: triggerRef.current.getBoundingClientRect() }
          : null,
    align,
    trigger: triggerRef,
    returnFocus: () => triggerRef.current?.focus(),
    remeasureOn,
  } satisfies UseAnchoredMenuOptions);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen((current) => !current)}>
        trigger
      </button>
      {open ? (
        <AnchoredMenu menuRef={menuRef} position={position} onKeyDown={onKeyDown} label="Test menu">
          <button type="button" role="menuitem" disabled>
            Disabled
          </button>
          <button type="button" role="menuitem">
            First
          </button>
          <button type="button" role="menuitem">
            Second
          </button>
        </AnchoredMenu>
      ) : null}
    </>
  );
}

function mockRects(trigger: DOMRect, menu: DOMRect): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') === 'menu') return menu;
    if (this.tagName === 'BUTTON' && this.textContent === 'trigger') return trigger;
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAnchoredMenu', () => {
  it('portals the menu to the body and focuses its first enabled item', () => {
    render(<Harness />);

    const menu = screen.getByRole('menu', { name: 'Test menu' });
    expect(menu.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'First' }));
  });

  it('clamps a point anchor into the viewport', () => {
    render(<Harness />);

    const menu = screen.getByRole('menu', { name: 'Test menu' });
    expect((menu as HTMLElement).style.left).toBe('100px');
    expect((menu as HTMLElement).style.top).toBe('120px');
  });

  it('anchors under a trigger and clamps an end-aligned menu to the viewport edge', () => {
    mockRects(rect(1000, 20, 40, 30), rect(0, 0, 200, 100));
    render(<Harness anchor="trigger" align="end" />);

    const menu = screen.getByRole('menu', { name: 'Test menu' });
    // 1000 + 40 - 200 = 840, clamped to 1024 - 200 - 8.
    expect((menu as HTMLElement).style.left).toBe('816px');
    expect((menu as HTMLElement).style.top).toBe('58px');
  });

  it('moves focus with the arrow keys and wraps at the ends', () => {
    render(<Harness />);
    const menu = screen.getByRole('menu', { name: 'Test menu' });
    const first = screen.getByRole('menuitem', { name: 'First' });
    const second = screen.getByRole('menuitem', { name: 'Second' });

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(second);
  });

  it('dismisses on Escape and gives focus back to the trigger', () => {
    render(<Harness />);

    fireEvent.keyDown(screen.getByRole('menu', { name: 'Test menu' }), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'trigger' }));
  });

  it('dismisses on a press outside itself but not on the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'trigger' });

    fireEvent.pointerDown(trigger);
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('dismisses when something outside scrolls, and not when the menu scrolls itself', () => {
    render(<Harness />);
    const menu = screen.getByRole('menu', { name: 'Test menu' });

    fireEvent.scroll(menu);
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.scroll(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('dismisses on resize', () => {
    render(<Harness />);
    const view = document.defaultView as Window;

    fireEvent(view, new Event('resize'));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('re-measures without stealing focus from the expanded control', () => {
    const { rerender } = render(<Harness remeasureOn={false} />);
    const second = screen.getByRole('menuitem', { name: 'Second' });
    second.focus();

    rerender(<Harness remeasureOn />);

    expect(document.activeElement).toBe(second);
  });
});
