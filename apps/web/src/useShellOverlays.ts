import { useCallback, useState } from 'react';
import type { SearchScope } from './search';
import type { ChatDto, MessageDto } from './types';

/**
The signed-in shell's overlay state: the search sheet and the new-message
picker, with the actions that open and settle them.

Both are page-level overlays whose state belongs to the shell but whose
meaning belongs to navigation — a search hit and a found chat are both
"open this chat", which the navigation layer already knows how to do. Split
from `SignedInShell` so that file keeps painting the screen instead of
growing one feature at a time.
*/

interface UseShellOverlaysOptions {
  /**
  Opens a search hit at its message, in the bridge's chat-first order.
  */
  openSearchResult: (chat: ChatDto, message: MessageDto) => void;
  /**
  Opens a chat the new-message picker found.
  */
  openFoundChat: (chat: ChatDto) => void;
}

interface ShellOverlayController {
  /**
  What the search overlay was opened for, or null when it is closed.
  */
  search: { scope: SearchScope; query?: string } | null;
  openGlobalSearch: () => void;
  /**
  Searches the open chat, when there is one.
  */
  openThreadSearch: (chat: ChatDto | null) => void;
  /**
  Searches every chat for a tapped hashtag.
  */
  searchHashtag: (hashtag: string) => void;
  /**
  Closes the search sheet and opens the chosen hit.
  */
  openSearchResult: (message: MessageDto, chat: ChatDto) => void;
  closeSearch: () => void;
  /**
  Whether the new-message picker is open.
  */
  newChat: boolean;
  openNewChat: () => void;
  /**
  Closes the picker and opens the chosen chat.
  */
  selectNewChat: (chat: ChatDto) => void;
  closeNewChat: () => void;
}

export function useShellOverlays({ openSearchResult, openFoundChat }: UseShellOverlaysOptions): ShellOverlayController {
  const [search, setSearch] = useState<{ scope: SearchScope; query?: string } | null>(null);
  const [newChat, setNewChat] = useState(false);

  const openGlobalSearch = useCallback((): void => setSearch({ scope: { kind: 'all' } }), []);
  const openThreadSearch = useCallback((chat: ChatDto | null): void => {
    if (chat !== null) setSearch({ scope: { kind: 'chat', chatId: chat.id } });
  }, []);
  const searchHashtag = useCallback((hashtag: string): void => {
    setSearch({ scope: { kind: 'all' }, query: hashtag });
  }, []);
  const closeSearch = useCallback((): void => setSearch(null), []);

  const openResult = useCallback(
    (message: MessageDto, chat: ChatDto): void => {
      setSearch(null);
      openSearchResult(chat, message);
    },
    [openSearchResult],
  );

  const openNewChat = useCallback((): void => setNewChat(true), []);
  const closeNewChat = useCallback((): void => setNewChat(false), []);
  const selectNewChat = useCallback(
    (chat: ChatDto): void => {
      setNewChat(false);
      openFoundChat(chat);
    },
    [openFoundChat],
  );

  return {
    search,
    openGlobalSearch,
    openThreadSearch,
    searchHashtag,
    openSearchResult: openResult,
    closeSearch,
    newChat,
    openNewChat,
    selectNewChat,
    closeNewChat,
  };
}
