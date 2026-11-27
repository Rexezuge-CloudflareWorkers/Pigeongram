import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { writeClipboard } from '../clipboard';
import { launchTelegramApp, usernameAppLink } from '../links';
import { formatPresence } from '../format';
import type { ChatDto, PresenceDto } from '../types';
import { useProfile } from '../useProfile';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Presence } from './Presence';
import { ProfilePopup } from './ProfilePopup';
import { AnchoredMenu, useAnchoredMenu } from './useAnchoredMenu';

/**
The nav bar of the open chat: who it is, and what can be done with it.

The peer's picture and its name open the profile, and the ⋮ menu holds the
actions that are about the chat rather than about the reader — the profile,
the handle to copy, the chat in the app, and the move into or out of the
archive.

The menu is a portal with `position: fixed` so the thread cannot clip it.
Its position is measured from the trigger once the menu has a size, then
clamped to the viewport; focus moves to the first item on open and returns
to the trigger when the menu closes.
*/

interface ThreadHeaderProps {
  chat: ChatDto;
  presence: PresenceDto | null;
  archived: boolean;
  onBack: () => void;
  /**
  Moves the chat into the archive, or back out of it. The promise settles
  when the move is done, so the confirmation can wait for it.
  */
  onSetArchived: (archived: boolean) => Promise<void>;
  /**
  Whether the chat is in the loaded list, so the archive move is meaningful.
  A chat reached through search is transient: it has no folder to move.
  */
  canArchive: boolean;
  /**
  Opens the search overlay scoped to this chat.
  */
  onSearch: () => void;
  /**
  Starts a voice call to the chat. Only a person can be called, so the
  button is offered for a user and for nobody else.
  */
  onCall: () => void;
  /**
  Whether a call is already up; the button is disabled until it ends.
  */
  callActive: boolean;
  /**
  Opens the chat's scheduled queue.
  */
  onOpenScheduled: () => void;
}

/**
How long the copied handle stays on the menu item, so the reader sees that
the write happened before the menu goes away.
*/
const COPY_FEEDBACK_MS = 1600;

export function ThreadHeader({
  chat,
  presence,
  archived,
  onBack,
  onSetArchived,
  canArchive,
  onSearch,
  onCall,
  callActive,
  onOpenScheduled,
}: ThreadHeaderProps) {
  const { t } = useTranslation();
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
  const presenceLabel = formatPresence(presence);
  const isOnline = presence?.status === 'online';

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
  The menu item asks before it moves: the archive takes the chat out of the
  list, and the reader may only have meant to look at the menu.
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
        <button type="button" className="back" onClick={onBack} aria-label={t('a11y.backToChatList', 'Back To Chat List')}>
          <Icon name="arrow-left" />
        </button>
        {/* The picture and the name are two ways to the same profile, and each
            is a control of its own. */}
        <button
          type="button"
          className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={(event) => openProfile(event.currentTarget)}
          aria-label={t('thread.viewProfileOf', 'View The Profile Of {{title}}', { title: chat.title })}
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
          {/* The official header always says where the peer stands; it rides
              the same presence the avatar badge shows. */}
          {presenceLabel === null ? null : <span className={`thread-presence${isOnline ? ' online' : ''}`}>{presenceLabel}</span>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton size="small" onClick={onSearch} aria-label={t('thread.searchIn', 'Search In {{title}}', { title: chat.title })}>
            <Icon name="search" />
          </IconButton>
          {chat.kind === 'user' ? (
            <IconButton
              size="small"
              onClick={onCall}
              disabled={callActive}
              aria-label={t('thread.callFor', 'Call {{title}}', { title: chat.title })}
            >
              <Icon name="call" />
            </IconButton>
          ) : null}
          <IconButton
            ref={triggerRef}
            size="small"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={t('thread.menuFor', 'Menu For {{title}}', { title: chat.title })}
          >
            <Icon name="more-vertical" />
          </IconButton>
        </div>
      </header>

      {menuOpen ? (
        <AnchoredMenu
          menuRef={menuRef}
          position={position}
          onKeyDown={onKeyDown}
          id={menuId}
          className="w-[220px] max-w-[calc(100vw-16px)] p-2"
          label={t('thread.menuFor', 'Menu For {{title}}', { title: chat.title })}
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
            <span>{t('thread.viewProfile', 'View Profile')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
            onClick={() => {
              setMenuOpen(false);
              onOpenScheduled();
            }}
          >
            <Icon name="schedule" className="text-muted" />
            <span>{t('thread.scheduledMessages', 'Scheduled Messages')}</span>
          </button>
          {username ? (
            <button
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
              onClick={() => void copyUsername()}
            >
              <Icon name="copy" className="text-muted" />
              <span>
                {copyState === 'copied'
                  ? t('thread.copied', 'Copied')
                  : copyState === 'failed'
                    ? t('thread.copyFailed', 'Copy Failed')
                    : t('thread.copyUsername', 'Copy @{{username}}', { username })}
              </span>
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
              <span>{t('thread.openInTelegram', 'Open In Telegram')}</span>
            </button>
          ) : null}
          {canArchive ? (
            <>
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
                <span>{archived ? t('thread.unarchiveChat', 'Unarchive Chat') : t('thread.archiveChatMenu', 'Archive Chat')}</span>
              </button>
            </>
          ) : null}
        </AnchoredMenu>
      ) : null}

      <Presence visible={profileOpen}>
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
      </Presence>

      <Presence visible={archiveConfirmOpen}>
        {archiveConfirmOpen ? (
          <ConfirmDialog
            title={
              archived ? t('thread.unarchiveConfirmTitle', 'Bring The Chat Back?') : t('thread.archiveConfirmTitle', 'Archive This Chat?')
            }
            message={
              archived
                ? t('thread.unarchiveConfirmBody', '{{title}} Comes Back To The Chat List.', { title: chat.title })
                : t(
                    'thread.archiveConfirmBody',
                    '{{title}} Leaves The Chat List And Goes To The Archive. You Can Bring It Back At Any Time.',
                    { title: chat.title },
                  )
            }
            confirmLabel={archived ? t('thread.unarchive', 'Unarchive') : t('thread.archive', 'Archive')}
            tone={archived ? 'accent' : 'danger'}
            busy={archiving}
            busyLabel={archived ? t('thread.unarchiving', 'Unarchiving…') : t('thread.archiving', 'Archiving…')}
            onConfirm={() => void confirmArchive()}
            onCancel={() => setArchiveConfirmOpen(false)}
            returnFocus={() => triggerRef.current?.focus()}
          />
        ) : null}
      </Presence>
    </>
  );
}
