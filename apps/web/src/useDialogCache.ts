import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import { isCacheAvailable, readDialogs, writeDialogs } from './cache';
import type { DialogDto, MeDto } from './types';

/**
The chat list's browser-cache half: paint a snapshot before the boot read,
then write through to it as folds change the two lists.

The controller owns the lists and its ready flag — only a controller that
has read or hydrated knows enough to write a snapshot. This hook owns when
and how the cache is touched, so the controller stays about live state.
*/

interface DialogCacheOptions {
  me: MeDto | null;
  main: DialogDto[];
  archived: DialogDto[];
  readyRef: RefObject<boolean>;
  /**
  Applies the snapshot to the controller's refs and state.
  */
  commit: (main: DialogDto[], archived: DialogDto[]) => void;
  /**
  Marks the list as no longer loading once a snapshot has been painted.
  */
  onHydrated: () => void;
}

export interface DialogCache {
  hydrate: (ownerId: number | null) => Promise<void>;
}

export function useDialogCache({ me, main, archived, readyRef, commit, onHydrated }: DialogCacheOptions): DialogCache {
  /**
  Paints the cached snapshot before the boot read. A snapshot from another
  account is never applied: Access names the account, and the cache is only
  a faster paint for it.
  */
  const hydrate = useCallback(
    async (ownerId: number | null): Promise<void> => {
      if (!isCacheAvailable()) {
        readyRef.current = true;
        return;
      }
      const snapshot = await readDialogs();
      readyRef.current = true;
      // A snapshot belongs to one account. Refusing a mismatch keeps a second
      // Access identity from seeing the first one's chats before the boot read.
      if (snapshot === null || ownerId === null || (snapshot.me?.id ?? null) !== ownerId) return;
      commit(snapshot.dialogs, snapshot.archived);
      onHydrated();
    },
    [readyRef, commit, onHydrated],
  );

  // Debounced write-through. Every fold goes through the controller's commit,
  // so one effect covers reads, live updates and optimistic moves without a
  // write per event.
  useEffect(() => {
    if (!readyRef.current || me === null) return;
    const timer = setTimeout(() => {
      void writeDialogs(main, archived, me);
    }, 500);
    return () => clearTimeout(timer);
  }, [main, archived, me, readyRef]);

  return { hydrate };
}
