import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { writeClipboard } from '../clipboard';
import { launchTelegramApp, usernameAppLink } from '../links';
import type { ChatDto, PresenceDto } from '../types';
import { useProfile } from '../useProfile';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { ProfilePopup } from './ProfilePopup';
import { AnchoredMenu, useAnchoredMenu } from './useAnchoredMenu';

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
  /**
   * Whether a call is already up; the button is disabled until it ends.
   */
  callActive: boolean;
}

/**
 * How long the copied handle stays on the menu item, so the reader sees that
 * the write happened before the menu goes away.
 */
const COPY_FEEDBACK_MS = 1600;

export function ThreadHeader({ chat, presence, archived, onBack, onSetArchived, onCall, callActive }: ThreadHeaderProps) {
  const { profile, loading, error, read } = useProfile(chat.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const menuId = useId();
  const username = chat.username;

  const closeProfile = useCallback((): void => {
    setProfileOpen(false);
  }, []);

  const { menuRef, position, onKeyDown } = useAnchoredMenu({
    open: menuOpen,
    onClose: () => setMenuOpen(false),
    anchor: () => {
      const trigger = triggerRef.current;
      return trigger ? { kind: 'trigger', rect: trigger.getBoundingClientRect() } : null;
    },
    align: 'end',
    trigger: triggerRef,
    returnFocus: () => triggerRef.current?.focus(),
  });

  // The profile belongs to the chat that was open when it was asked for, so a
  // chat the reader has moved on from must not be described by it.
  const openProfile = (opener: HTMLElement | null): void => {
    openerRef.current = opener;
    setProfileOpen(true);
    read(chat.id);
  };

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
            className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onCall}
            disabled={callActive}
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

      {menuOpen ? (
        <AnchoredMenu
          menuRef={menuRef}
          position={position}
          onKeyDown={onKeyDown}
          id={menuId}
          className="fixed z-50 w-[220px] max-w-[calc(100vw-16px)] rounded-2xl border border-line bg-panel-2 p-2 shadow-2xl"
          label={`Menu for ${chat.title}`}
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
        </AnchoredMenu>
      ) : null}

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
