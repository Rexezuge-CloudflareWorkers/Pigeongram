import { useEffect, useRef } from 'react';
import { fetchBootstrap } from './api';
import type { Route } from './routes';
import type { DialogDto, MeDto, PeerId } from './types';

/**
The signed-in shell's first read. The cached chat list paints first, then
the boot read replaces it, while a deep link resolves beside both so a
shared URL never waits for the sidebar to become usable.

Kept out of the shell so the account plane stays under the god-file cap.
*/

interface ShellBootOptions {
  initialMe: MeDto | null;
  setMe: (me: MeDto | null) => void;
  hydrateDialogs: (ownerId: number | null) => Promise<void>;
  applyDialogs: (dialogs: DialogDto[]) => void;
  loadDialogs: () => Promise<void>;
  loadArchive: () => Promise<void>;
  canOpen: (route: Route) => boolean;
  findDialog: (chatId: PeerId) => DialogDto | undefined;
  bootRouter: () => void;
  currentRoute: () => Route;
  prepareInitialRoute: (route: Route) => unknown;
  replaceTo: (route: Route) => void;
  onArchiveContext: (archived: boolean) => void;
}

export function useShellBoot({
  initialMe,
  setMe,
  hydrateDialogs,
  applyDialogs,
  loadDialogs,
  loadArchive,
  canOpen,
  findDialog,
  bootRouter,
  currentRoute,
  prepareInitialRoute,
  replaceTo,
  onArchiveContext,
}: ShellBootOptions): void {
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      if (initialMe) setMe(initialMe);
      const target = currentRoute();
      const bootstrap = (async (): Promise<void> => {
        // The cached list paints before the network read. It is applied only
        // when it belongs to the account the Access probe just named, and the
        // boot below replaces it with the server's truth either way.
        if (initialMe?.id !== undefined && initialMe.id !== null) await hydrateDialogs(initialMe.id);
        try {
          // The account and the chat list come back in one request. This read
          // starts beside initial deep-link resolution so the thread does not
          // wait for the sidebar to become usable.
          const boot = await fetchBootstrap();
          setMe(boot.me ?? initialMe ?? null);
          applyDialogs(boot.dialogs);
        } catch {
          // The combined read failed; the chat list on its own may still work,
          // and it reports its own failure if it does not.
          await loadDialogs();
        }
      })();
      const initial = prepareInitialRoute(target);
      await Promise.race([bootstrap, initial]);
      const deepLink = target.view === 'chat' || target.view === 'comments';
      if (deepLink && canOpen(target)) {
        // The target was resolved or found before the sidebar finished. Apply
        // it now; the bootstrap continues in parallel and fills the sidebar.
        bootRouter();
        void (async () => {
          await bootstrap;
          if (canOpen(target)) return;
          await loadArchive();
          const resolved = findDialog(target.chatId);
          if (resolved) {
            onArchiveContext(resolved.archived);
          } else {
            replaceTo({ view: 'list' });
          }
        })();
        return;
      }
      // A shared link may name a chat in the archive, which the chat list does
      // not carry: finish both initial reads before the archive fallback.
      await Promise.all([bootstrap, initial]);
      if (deepLink && !canOpen(target)) await loadArchive();
      bootRouter();
    })();
  }, [
    initialMe,
    setMe,
    hydrateDialogs,
    applyDialogs,
    loadDialogs,
    loadArchive,
    canOpen,
    findDialog,
    bootRouter,
    currentRoute,
    prepareInitialRoute,
    replaceTo,
    onArchiveContext,
  ]);
}
