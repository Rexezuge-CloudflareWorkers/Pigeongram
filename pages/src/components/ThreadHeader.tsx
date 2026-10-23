import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { writeClipboard } from '../clipboard';
import { launchTelegramApp, usernameAppLink } from '../links';
import type { ChatDto, PresenceDto } from '../types';
import { useProfile } from '../useProfile';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { ProfilePopup } from './ProfilePopup';

/**
 * The nav bar of the open chat: who it is, and what can be done with it.
 *
 * The peer's picture and its name open the profile, and the ⋮ menu holds the
 * actions that are about the chat rather than about the reader — the profile,
 * the handle to copy, the chat in the app, and the move into or out of the
 * archive.
 *
 * The menu is a portal with `position: fixed` so the thread cannot clip it.
 * Its position is measured from the trigger once the menu has a size, then
 * clamped to the viewport; focus moves to the first item on open and returns
 * to the trigger when the menu closes.
 */

interface ThreadHeaderProps {
  chat: ChatDto;
  presence: PresenceDto | null;
  archived: boolean;
  onBack: () => void;
  /**
   * Moves the chat into the archive, or back out of it. The promise settles
   * when the move is done, so the confirmation can wait for it.
   */
  onSetArchived: (archived: boolean) => Promise<void>;
  /**
   * Starts a voice call to the chat. Only a person can be called, so the
   * button is offered for a user and for nobody else.
   */
  onCall: () => void;
}

/**
 * How long the copied handle stays on the menu item, so the reader sees that
 * the write happened before the menu goes away.
 */
const COPY_FEEDBACK_MS = 1600;

export function ThreadHeader({ chat, presence, archived, onBack, onSetArchived, onCall }: ThreadHeaderProps) {
  const { profile, loading, error, read } = useProfile(chat.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const menuId = useId();
  const username = chat.username;

  const closeMenu = useCallback((): void => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }, []);

  const closeProfile = useCallback((): void => {
    setProfileOpen(false);
  }, []);

  // The profile belongs to the chat that was open when it was asked for, so a
  // chat the reader has moved on from must not be described by it.
  const openProfile = (opener: HTMLElement | null): void => {
    openerRef.current = opener;
    setProfileOpen(true);
    read(chat.id);
  };

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
      left: Math.max(margin, Math.min(triggerRect.right - width, window.innerWidth - width - margin)),
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

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copyUsername = async (): Promise<void> => {
    if (!username) return;
    try {
      await writeClipboard(`@${username}`);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const openInTelegram = (): void => {
    if (!username) return;
    const { deepLink, webUrl } = usernameAppLink(username);
    launchTelegramApp(deepLink, webUrl);
  };

  /**
   * The menu item asks before it moves: the archive takes the chat out of the
   * list, and the reader may only have meant to look at the menu.
   */
  const requestArchive = (): void => {
    setMenuOpen(false);
    setArchiveConfirmOpen(true);
  };

  const confirmArchive = useCallback(async (): Promise<void> => {
    setArchiving(true);
    try {
      await onSetArchived(!archived);
      setArchiveConfirmOpen(false);
    } finally {
      setArchiving(false);
    }
  }, [archived, onSetArchived]);

  return (
    <>
      <header className="thread-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back to chat list">
          <Icon name="arrow-left" />
        </button>
        {/* The picture and the name are two ways to the same profile, and each
            is a control of its own. */}
        <button
          type="button"
          className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={(event) => openProfile(event.currentTarget)}
          aria-label={`View the profile of ${chat.title}`}
        >
          <Avatar chatId={chat.id} photo={chat.photo} title={chat.title} kind={chat.kind} small presence={presence} />
        </button>
        <div className="thread-title">
          <button
            type="button"
            className="truncate text-left font-bold transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={(event) => openProfile(event.currentTarget)}
          >
            {chat.title}
          </button>
        </div>
        {chat.kind === 'user' ? (
          <button
            type="button"
            className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onCall}
            aria-label={`Call ${chat.title}`}
          >
            <Icon name="call" />
          </button>
        ) : null}
        <button
          ref={triggerRef}
          type="button"
          className={`${chat.kind === 'user' ? '' : 'ml-auto'} inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={`Menu for ${chat.title}`}
        >
          <Icon name="more-vertical" />
        </button>
      </header>

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
                className="fixed z-50 w-[220px] max-w-[calc(100vw-16px)] rounded-2xl border border-line bg-panel-2 p-2 shadow-2xl"
                role="menu"
                aria-label={`Menu for ${chat.title}`}
                style={{ left: position.left, top: position.top }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  moveMenuFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
                  onClick={() => {
                    setMenuOpen(false);
                    openProfile(triggerRef.current);
                  }}
                >
                  <Icon name="person" className="text-muted" />
                  <span>View Profile</span>
                </button>
                {username ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
                    onClick={() => void copyUsername()}
                  >
                    <Icon name="copy" className="text-muted" />
                    <span>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : `Copy @${username}`}</span>
                  </button>
                ) : null}
                {username ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
                    onClick={openInTelegram}
                  >
                    <Icon name="open-in-new" className="text-muted" />
                    <span>Open in Telegram</span>
                  </button>
                ) : null}
                <div className="my-1 h-px bg-line" role="separator" />
                {/* The archive is Telegram's own place for the chats that are
                    put away; the item offers the move in the direction the
                    chat is not in, and the move asks first. */}
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
                  onClick={requestArchive}
                >
                  <Icon name={archived ? 'unarchive' : 'archive'} className="text-muted" />
                  <span>{archived ? 'Unarchive Chat' : 'Archive Chat'}</span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      {profileOpen ? (
        <ProfilePopup
          chat={chat}
          profile={profile}
          loading={loading}
          error={error}
          onClose={closeProfile}
          returnFocus={() => openerRef.current?.focus()}
        />
      ) : null}

      {archiveConfirmOpen ? (
        <ConfirmDialog
          title={archived ? 'Bring the chat back?' : 'Archive this chat?'}
          message={
            archived
              ? `${chat.title} comes back to the chat list.`
              : `${chat.title} leaves the chat list and goes to the archive. You can bring it back at any time.`
          }
          confirmLabel={archived ? 'Unarchive' : 'Archive'}
          tone={archived ? 'accent' : 'danger'}
          busy={archiving}
          busyLabel={archived ? 'Unarchiving…' : 'Archiving…'}
          onConfirm={() => void confirmArchive()}
          onCancel={() => setArchiveConfirmOpen(false)}
          returnFocus={() => triggerRef.current?.focus()}
        />
      ) : null}
    </>
  );
}

/**
 * Cycles focus through the menu's items; the index is taken from the focused
 * item, so opening (first item focused) and tabbing in both wrap sensibly.
 */
function moveMenuFocus(container: HTMLElement, step: number): void {
  const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[(index + step + items.length) % items.length].focus();
}
