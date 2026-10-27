import { useCallback, useMemo, useRef, useState } from 'react';
import { fetchArchivedDialogs, fetchDialogs, setArchived as setArchivedRpc } from './api';
import { applyEditedMessage, applyNewMessage, applyOutboxReadUpdate, applyReadThrough, applyReadUpdate, applyUserStatus } from './state';
import type { DialogDto, MessageDto, PeerId, UpdateEvent } from './types';

/**
The account's chat list.

Two lists, one array: the main chats first, the archived ones after. The
archive is a separate read — Telegram keeps it in its own peer folder — so the
two arrive apart, but everything that looks a chat up (the router, the thread,
the read receipts, the forward picker) has to find it in the same place, or a
chat would be invisible to half of them.
*/
export interface DialogsController {
  /**
  Every chat the client knows, the main ones first.
  */
  readonly all: DialogDto[];
  /**
  The main chat list.
  */
  readonly main: DialogDto[];
  /**
  The archived chats; empty until the archive has been read.
  */
  readonly archived: DialogDto[];
  readonly loading: boolean;
  readonly archiveLoading: boolean;
  /**
  The chat's dialog, in either list.
  */
  find: (chatId: PeerId) => DialogDto | undefined;
  /**
  Replaces the main list (the boot, a resync). The archive is left alone.
  */
  apply: (dialogs: DialogDto[]) => void;
  /**
  Reads the main list.
  */
  load: () => Promise<void>;
  /**
  Reads the archive.
  */
  loadArchive: () => Promise<void>;
  /**
  Drops the lists: the account they belonged to is gone (a sign-out).
  */
  clear: () => void;
  /**
  Folds a live update into the lists.
  */
  applyUpdate: (update: UpdateEvent, activeChatId: PeerId | null) => void;
  /**
  Folds an optimistic read into the lists.
  */
  applyRead: (chatId: PeerId, maxId: number, messages: readonly MessageDto[]) => void;
  /**
  Moves a chat into the archive, or back out of it.
  */
  setArchived: (chatId: PeerId, archived: boolean) => Promise<void>;
}

export interface DialogsOptions {
  /**
  Where a failed read or write is reported.
  */
  onError: (failure: unknown) => void;
  /**
  Where the outcome of a successful write is announced.
  */
  onNotice: (text: string) => void;
}

export function useDialogs({ onError, onNotice }: DialogsOptions): DialogsController {
  const [main, setMain] = useState<DialogDto[]>([]);
  const [archived, setArchivedList] = useState<DialogDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveLoading, setArchiveLoading] = useState(false);

  // The lists are kept in refs as well: the router applies a route right after
  // the boot read resolves, before React has committed the new list.
  const mainRef = useRef<DialogDto[]>([]);
  const archivedRef = useRef<DialogDto[]>([]);
  const ref = useRef<DialogDto[]>([]);

  /**
  Writes both lists. The refs come first: the caller may read the list in the
  same tick, before React has committed the state.
  */
  const commit = useCallback((nextMain: DialogDto[], nextArchived: DialogDto[]): void => {
    mainRef.current = nextMain;
    archivedRef.current = nextArchived;
    ref.current = [...nextMain, ...nextArchived];
    setMain(nextMain);
    setArchivedList(nextArchived);
  }, []);

  const apply = useCallback(
    (dialogs: DialogDto[]): void => {
      commit(dialogs, archivedRef.current);
      // The list is here, so it is no longer loading: the boot read it in one
      // request and never asked for it again.
      setLoading(false);
    },
    [commit],
  );

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await fetchDialogs();
      commit(result.dialogs, archivedRef.current);
    } catch (failure) {
      onError(failure);
    } finally {
      setLoading(false);
    }
  }, [commit, onError]);

  const loadArchive = useCallback(async (): Promise<void> => {
    setArchiveLoading(true);
    try {
      const result = await fetchArchivedDialogs();
      commit(mainRef.current, result.dialogs);
    } catch (failure) {
      onError(failure);
    } finally {
      setArchiveLoading(false);
    }
  }, [commit, onError]);

  const applyUpdate = useCallback(
    (update: UpdateEvent, activeChatId: PeerId | null): void => {
      const current = mainRef.current;
      const currentArchive = archivedRef.current;
      switch (update.type) {
        case 'new_message': {
          // Reading is driven by the view's scroll position: a message pinned
          // to the bottom of the open thread is reported read from there, and
          // one arriving while the user is scrolled up stays unread.
          commit(applyNewMessage(current, update.message, activeChatId), applyNewMessage(currentArchive, update.message, activeChatId));
          return;
        }
        case 'edit_message': {
          commit(applyEditedMessage(current, update.message), applyEditedMessage(currentArchive, update.message));
          return;
        }
        case 'read': {
          commit(
            update.inbox
              ? applyReadUpdate(current, update.chatId, update.unread, update.maxId)
              : applyOutboxReadUpdate(current, update.chatId, update.maxId),
            update.inbox
              ? applyReadUpdate(currentArchive, update.chatId, update.unread, update.maxId)
              : applyOutboxReadUpdate(currentArchive, update.chatId, update.maxId),
          );
          return;
        }
        case 'user_status': {
          commit(applyUserStatus(current, update.userId, update.presence), applyUserStatus(currentArchive, update.userId, update.presence));
          return;
        }
        default: {
          // The other updates (reactions, views, polls) belong to the open
          // thread, not to the chat list.
          return;
        }
      }
    },
    [commit],
  );

  const applyRead = useCallback(
    (chatId: PeerId, maxId: number, messages: readonly MessageDto[]): void => {
      commit(applyReadThrough(mainRef.current, chatId, maxId, messages), applyReadThrough(archivedRef.current, chatId, maxId, messages));
    },
    [commit],
  );

  /**
  Moves a chat into the archive, or back out of it.

  The move is optimistic — the chat leaves the list it was in at once — and a
  failed call puts it back where it was. The outcome is announced once the
  bridge has answered, so a toast never claims a move that did not happen.
  */
  const setArchived = useCallback(
    async (chatId: PeerId, archived: boolean): Promise<void> => {
      const current = ref.current.find((dialog) => dialog.chat.id === chatId);
      if (!current || current.archived === archived) return;
      const before = { main: mainRef.current, archived: archivedRef.current };
      const moved = moveDialog(before.main, before.archived, current, archived);
      commit(moved.main, moved.archived);
      try {
        await setArchivedRpc(chatId, archived);
        onNotice(archived ? 'Chat Archived' : 'Chat Restored');
      } catch (failure) {
        commit(before.main, before.archived);
        onError(failure);
      }
    },
    [commit, onError, onNotice],
  );

  const find = useCallback((chatId: PeerId): DialogDto | undefined => {
    return ref.current.find((dialog) => dialog.chat.id === chatId);
  }, []);

  const clear = useCallback((): void => {
    commit([], []);
    setLoading(true);
    setArchiveLoading(false);
  }, [commit]);

  const all = useMemo(() => [...main, ...archived], [main, archived]);

  return {
    all,
    main,
    archived,
    loading,
    archiveLoading,
    find,
    apply,
    load,
    loadArchive,
    clear,
    applyUpdate,
    applyRead,
    setArchived,
  };
}

/**
Moves a chat from one list into the other.

A chat that comes back out of the archive lands at the top of the main list,
below the pinned ones: it is the newest chat again, the way Telegram shows it.
*/
function moveDialog(
  main: DialogDto[],
  archived: DialogDto[],
  dialog: DialogDto,
  toArchived: boolean,
): { main: DialogDto[]; archived: DialogDto[] } {
  const moved: DialogDto = { ...dialog, archived: toArchived };
  const nextMain = main.filter((candidate) => candidate.chat.id !== moved.chat.id);
  const nextArchived = archived.filter((candidate) => candidate.chat.id !== moved.chat.id);
  if (toArchived) {
    return { main: nextMain, archived: [...nextArchived, moved] };
  }
  const pinned = nextMain.filter((candidate) => candidate.pinned).length;
  nextMain.splice(pinned, 0, moved);
  return { main: nextMain, archived: nextArchived };
}
