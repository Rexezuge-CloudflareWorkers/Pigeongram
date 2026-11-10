import type { SearchScope } from '../search';
import type { ChatDto, DialogDto, MessageDto } from '../types';
import { ForwardPicker } from './ForwardPicker';
import { Presence } from './Presence';
import { SearchOverlay } from './SearchOverlay';

interface ShellOverlaysProps {
  /**
  The open chat, which the search overlay offers as a scope.
  */
  chat: ChatDto | null;
  /**
  Every loaded dialog, the forward picker's destinations.
  */
  dialogs: readonly DialogDto[];
  /**
  The messages being forwarded, or null when the picker is closed.
  */
  forwardTarget: readonly MessageDto[] | null;
  onForward: (dialog: DialogDto) => Promise<void>;
  onCloseForward: () => void;
  /**
  What the search overlay was opened for, or null when it is closed.
  */
  search: { scope: SearchScope; query?: string } | null;
  onOpenResult: (message: MessageDto, chat: ChatDto) => void;
  onCloseSearch: () => void;
}

/**
 * The shell's two page-level overlays, kept out of `SignedInShell` so that file
 * stays under the god-file cap. Both close through `Presence`, which holds
 * them for the exit beat after their state has already been cleared.
 */
export function ShellOverlays({
  chat,
  dialogs,
  forwardTarget,
  onForward,
  onCloseForward,
  search,
  onOpenResult,
  onCloseSearch,
}: ShellOverlaysProps) {
  return (
    <>
      <Presence visible={forwardTarget !== null}>
        {forwardTarget === null ? null : (
          <ForwardPicker messages={forwardTarget} dialogs={dialogs} onForward={onForward} onClose={onCloseForward} />
        )}
      </Presence>
      <Presence visible={search !== null}>
        {search === null ? null : (
          <SearchOverlay
            chat={chat}
            initialScope={search.scope}
            initialQuery={search.query}
            onOpenResult={onOpenResult}
            onClose={onCloseSearch}
          />
        )}
      </Presence>
    </>
  );
}
