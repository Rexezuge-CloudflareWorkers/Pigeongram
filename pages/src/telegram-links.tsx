import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { LinkClickHandler } from './richtext';

/**
 * The app's router for links inside message bodies.
 *
 * `App` provides the handler: it returns `true` when it claimed the link (a
 * Telegram chat this client knows, or a handoff to the installed app) and
 * `false` for ordinary web links, which keep their default new-tab behavior.
 * A context because the deep components that render message text (`MessageRow`,
 * its album captions and reply quotes) would otherwise all thread a handler
 * through their props.
 */

const TelegramLinkContext = createContext<LinkClickHandler | null>(null);

export function TelegramLinkProvider({ handler, children }: { handler: LinkClickHandler; children: ReactNode }) {
  return <TelegramLinkContext.Provider value={handler}>{children}</TelegramLinkContext.Provider>;
}

export function useTelegramLinkHandler(): LinkClickHandler | null {
  return useContext(TelegramLinkContext);
}
