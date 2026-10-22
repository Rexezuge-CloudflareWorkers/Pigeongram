import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PwaState } from '../pwa/usePwa';
import type { MeDto } from '../types';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';

/**
The sidebar's account control. The profile row is the trigger for a
Material-style menu anchored under it; the archive and Sign out live in that
menu, and Sign out asks for confirmation in a modal before the existing logout
flow runs.

The menu is a portal with `position: fixed` so the sidebar cannot clip it. Its
position is measured from the trigger once the menu has a size, then clamped to
the viewport. Focus moves to the first menu item on open, returns to the trigger
when the menu closes, and the confirmation dialog takes over from there.
*/

interface UserMenuProps {
  me: MeDto | null;
  connected: boolean;
  /**
  The install offer, when the browser raised one.
  */
  pwa: PwaState;
  onSignOut: () => Promise<void> | void;
  /**
  Opens the archive: the chats the account archived.
  */
  onOpenArchive: () => void;
}

export function UserMenu({ me, connected, pwa, onSignOut, onOpenArchive }: UserMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const displayName = me ? `${me.firstName}${me.lastName ? ` ${me.lastName}` : ''}` : 'Telegram';
  const handle = me?.username ? `@${me.username}` : me?.phone;

  const focusTrigger = useCallback((): void => {
    triggerRef.current?.focus();
  }, []);

  const closeMenu = useCallback((): void => {
    setMenuOpen(false);
    focusTrigger();
  }, [focusTrigger]);

  // Measure after the menu mounts: the first paint is already at the trigger's
  // coordinates, and the layout effect settles the final clamped position
  // before the browser paints. Focusing the first item keeps the menu
  // keyboard-driven from the moment it opens.
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (trigger === null || menu === null) return;
    const triggerRect = trigger.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(triggerRect.left, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(triggerRect.bottom + margin, window.innerHeight - height - margin)),
    });
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu();
    };
    const onResize = (): void => {
      // The anchor may have moved out from under the menu; close rather than
      // leave it pointing at the wrong place.
      closeMenu();
    };
    addEventListener('keydown', onKeyDown, { capture: true });
    addEventListener('resize', onResize);
    return () => {
      removeEventListener('keydown', onKeyDown, { capture: true });
      removeEventListener('resize', onResize);
    };
  }, [closeMenu, menuOpen]);

  const requestSignOut = (): void => {
    setMenuOpen(false);
    setConfirmOpen(true);
  };

  const requestArchive = (): void => {
    setMenuOpen(false);
    onOpenArchive();
  };

  /**
  Hands the browser's install offer back to it. The offer is spent once, so
  the row disappears after the reader takes it or dismisses it.
  */
  const requestInstall = (): void => {
    setMenuOpen(false);
    pwa.install();
  };

  const confirmSignOut = useCallback(async (): Promise<void> => {
    setSigningOut(true);
    try {
      await onSignOut();
      setConfirmOpen(false);
    } catch {
      // The parent surfaces the failure; keep the dialog open so the user can
      // retry instead of dropping them out of the confirmation.
    } finally {
      setSigningOut(false);
    }
  }, [onSignOut]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-1 text-left transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-expanded:bg-panel-2"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        aria-label={`Account menu for ${displayName}`}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="relative inline-flex shrink-0">
          <Avatar chatId={me?.id ?? 0} photo={me?.photo ?? null} title={displayName} small />
          {/* Presence badge: decorative, so the status text carries the meaning
              for assistive tech. The ring matches the sidebar panel behind it. */}
          <span
            aria-hidden="true"
            data-status={connected ? 'online' : 'pending'}
            className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-panel ${connected ? 'bg-online' : 'bg-warn'}`}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate">{displayName}</strong>
          <span className="text-xs text-muted">{connected ? 'Online' : 'Connecting…'}</span>
        </span>
        <svg
          className={`size-4 shrink-0 fill-current text-muted transition-transform${menuOpen ? ' rotate-180' : ''}`}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z" />
        </svg>
      </button>

      {menuOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50"
              onClick={(event) => {
                if (event.target === event.currentTarget) closeMenu();
              }}
            >
              <div
                ref={menuRef}
                id={menuId}
                className="fixed z-50 w-[280px] max-w-[calc(100vw-16px)] rounded-2xl border border-line bg-panel-2 p-2 shadow-2xl"
                role="menu"
                aria-label="Account menu"
                style={{ left: position.left, top: position.top }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  moveMenuFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
                }}
              >
                <div className="flex min-w-0 flex-col gap-0.5 px-3 pt-2 pb-3">
                  <strong className="truncate font-semibold">{displayName}</strong>
                  {handle ? <span className="truncate text-xs text-muted">{handle}</span> : null}
                </div>
                <div className="my-1 h-px bg-line" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
                  onClick={requestArchive}
                >
                  <svg className="size-5 shrink-0 fill-current text-muted" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23A1.98 1.98 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.5-.18-.96-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z" />
                  </svg>
                  <span>Archived Chats</span>
                </button>
                {pwa.canInstall ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
                    onClick={requestInstall}
                  >
                    <svg className="size-5 shrink-0 fill-current text-muted" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
                    </svg>
                    <span>Install app</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:bg-danger/10 focus-visible:outline-none"
                  onClick={requestSignOut}
                >
                  <svg className="size-5 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                  </svg>
                  <span>Sign out</span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      {confirmOpen ? (
        <ConfirmDialog
          title="Sign out of Telegram?"
          message="This ends the session on this client. You'll need to sign in again to use the app."
          confirmLabel="Sign out"
          busy={signingOut}
          busyLabel="Signing out…"
          onConfirm={() => void confirmSignOut()}
          onCancel={() => setConfirmOpen(false)}
          returnFocus={focusTrigger}
        />
      ) : null}
    </>
  );
}

/**
Cycles focus through the menu's items; the index is taken from the focused
item, so opening (first item focused) and tabbing in both wrap sensibly.
*/
function moveMenuFocus(container: HTMLElement, step: number): void {
  const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[(index + step + items.length) % items.length].focus();
}
