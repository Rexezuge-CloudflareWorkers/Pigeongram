import { useCallback, useEffect, useRef, useState } from 'react';
import { registerServiceWorker, type InstallPromptEvent } from './register';

export interface PwaState {
  /**
   * Whether the browser offered to install the client as an app.
   */
  readonly canInstall: boolean;
  /**
   * Asks the browser to show its install prompt. Does nothing when there is
   * no offer to show.
   */
  readonly install: () => void;
}

/**
 * The installable side of the app.
 *
 * The browser decides whether the client is installable and raises the offer;
 * the app keeps that offer around so the account menu can hand it back when
 * the reader asks for it. The offer is spent once: the browser does not raise
 * it again, and the installed app is what the reader wanted anyway.
 */
export function usePwa(): PwaState {
  const [canInstall, setCanInstall] = useState(false);
  const promptRef = useRef<InstallPromptEvent | null>(null);

  useEffect(() => {
    registerServiceWorker();

    const onOffer = (event: Event): void => {
      // The browser would show its own prompt on its own; the app asks for it
      // instead, so the offer can be spent where the reader asked for it.
      event.preventDefault();
      promptRef.current = event as InstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = (): void => {
      promptRef.current = null;
      setCanInstall(false);
    };

    addEventListener('beforeinstallprompt', onOffer);
    addEventListener('appinstalled', onInstalled);
    return () => {
      removeEventListener('beforeinstallprompt', onOffer);
      removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback((): void => {
    const prompt = promptRef.current;
    if (prompt === null) return;
    void prompt.prompt();
    void prompt.userChoice.then(() => {
      promptRef.current = null;
      setCanInstall(false);
    });
  }, []);

  return { canInstall, install };
}
