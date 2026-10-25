import { useCallback, useId, useRef, useState } from 'react';
import type { PwaState } from '../pwa/usePwa';
import type { MeDto } from '../types';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { AnchoredMenu, useAnchoredMenu } from './useAnchoredMenu';

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const displayName = me ? `${me.firstName}${me.lastName ? ` ${me.lastName}` : ''}` : 'Telegram';
  const handle = me?.username ? `@${me.username}` : me?.phone;

  const focusTrigger = useCallback((): void => {
    triggerRef.current?.focus();
  }, []);

  const { menuRef, position, onKeyDown } = useAnchoredMenu({
    open: menuOpen,
    onClose: () => setMenuOpen(false),
    anchor: () => {
      const trigger = triggerRef.current;
      return trigger ? { kind: 'trigger', rect: trigger.getBoundingClientRect() } : null;
    },
    trigger: triggerRef,
    returnFocus: focusTrigger,
  });

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
        <Icon name="chevron-down" size={16} className={`text-muted transition-transform${menuOpen ? ' rotate-180' : ''}`} />
      </button>

      {menuOpen ? (
        <AnchoredMenu
          menuRef={menuRef}
          position={position}
          onKeyDown={onKeyDown}
          id={menuId}
          className="fixed z-50 w-[280px] max-w-[calc(100vw-16px)] rounded-2xl border border-line bg-panel-2 p-2 shadow-2xl"
          label="Account menu"
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
            <Icon name="archive" className="text-muted" />
            <span>Archived Chats</span>
          </button>
          {pwa.canInstall ? (
            <button
              type="button"
              role="menuitem"
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
              onClick={requestInstall}
            >
              <Icon name="download" className="text-muted" />
              <span>Install app</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:bg-danger/10 focus-visible:outline-none"
            onClick={requestSignOut}
          >
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </AnchoredMenu>
      ) : null}

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
