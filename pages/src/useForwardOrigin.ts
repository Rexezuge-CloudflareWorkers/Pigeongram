import { useCallback } from 'react';
import { forwardOriginLink, launchTelegramApp } from './links';
import type { ChatDto, DialogDto, MessageForwardDto } from './types';

/**
 * Opens the chat a forwarded message came from.
 *
 * The origin is addressed by `senderId` first (saved-messages headers also
 * carry `fromChatId`), matching how Telegram credits the forward. A chat the
 * account already has open in its loaded dialogs opens in the thread; anything
 * else is handed to the installed app, the same fallback an unknown Telegram
 * link takes.
 */
export function useForwardOrigin(dialogs: readonly DialogDto[], openChat: (chat: ChatDto) => void): (forward: MessageForwardDto) => void {
  return useCallback(
    (forward: MessageForwardDto): void => {
      const target = forward.senderId ?? forward.fromChatId;
      if (target === null) return;
      const dialog = dialogs.find((candidate) => candidate.chat.id === target);
      if (dialog !== undefined) {
        openChat(dialog.chat);
        return;
      }
      const link = forwardOriginLink(forward);
      if (link !== null) launchTelegramApp(link.deepLink, link.webUrl);
    },
    [dialogs, openChat],
  );
}
