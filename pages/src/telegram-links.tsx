import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { LinkClickHandler } from './richtext';
import type { MessageForwardDto } from './types';

/**
 * The app's router for Telegram navigation points inside message bubbles.
 *
 * `App` provides the link handler: it returns `true` when it claimed the link
 * (a Telegram chat this client knows, or a handoff to the installed app) and
 * `false` for ordinary web links, which keep their default new-tab behavior.
 * The forward handler opens the chat a "Forwarded from …" header credits.
 *
 * Contexts because the deep components that render message text (`MessageRow`,
 * its album captions and reply quotes) and the forward header would otherwise
 * all thread handlers through their props.
 */

export type ForwardOriginHandler = (forward: MessageForwardDto) => void;

const TelegramLinkContext = createContext<LinkClickHandler | null>(null);
const ForwardOriginContext = createContext<ForwardOriginHandler | null>(null);

export function TelegramLinkProvider({
  handler,
  onOpenForward,
  children,
}: {
  handler: LinkClickHandler;
  onOpenForward?: ForwardOriginHandler;
  children: ReactNode;
}) {
  return (
    <TelegramLinkContext.Provider value={handler}>
      <ForwardOriginContext.Provider value={onOpenForward ?? null}>{children}</ForwardOriginContext.Provider>
    </TelegramLinkContext.Provider>
  );
}

export function useTelegramLinkHandler(): LinkClickHandler | null {
  return useContext(TelegramLinkContext);
}

export function useForwardOriginHandler(): ForwardOriginHandler | null {
  return useContext(ForwardOriginContext);
}
