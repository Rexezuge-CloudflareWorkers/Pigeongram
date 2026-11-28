import { useTranslation } from 'react-i18next';
import type { PwaState } from '../pwa/usePwa';
import type { MeDto } from '../types';
import { Icon } from './Icon';
import { UserMenu } from './UserMenu';

/**
The sidebar's top bar: the account control, the new-message button and the
search button.

Kept out of `SignedInShell` because the shell is the data plane and this is
pure chrome, and because the shell sits at the god-file cap. The account menu
owns its own popups; this only routes the two clicks.
*/

interface SidebarHeaderProps {
  me: MeDto | null;
  connected: boolean;
  pwa: PwaState;
  onSignOut: () => Promise<void> | void;
  onOpenArchive: () => void;
  /**
  Opens the settings screen over the current one.
  */
  onOpenSettings: () => void;
  onNewChat: () => void;
  onSearch: () => void;
}

export function SidebarHeader({ me, connected, pwa, onSignOut, onOpenArchive, onOpenSettings, onNewChat, onSearch }: SidebarHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="me">
      <UserMenu
        me={me}
        connected={connected}
        pwa={pwa}
        onSignOut={onSignOut}
        onOpenArchive={onOpenArchive}
        onOpenSettings={onOpenSettings}
      />
      <button
        type="button"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onNewChat}
        aria-label={t('newChat.title', 'New Message')}
      >
        <Icon name="edit" />
      </button>
      <button
        type="button"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onSearch}
        aria-label={t('a11y.sidebarSearch', 'Search Messages')}
      >
        <Icon name="search" />
      </button>
    </header>
  );
}
