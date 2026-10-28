import { useCallback } from 'react';
import { findLinkedChat, forwardOriginTarget } from './links';
import type { TelegramChatTarget } from './links';
import type { ChatDto, DialogDto, MessageForwardDto } from './types';

/**
 * Opens the chat a forwarded message came from.
 *
 * The origin is addressed by `senderUsername` first (saved-messages headers
 * also carry `fromChatId`), matching how Telegram credits the forward. A chat
 * the account already has in its loaded dialogs opens in the thread; anything
 * else goes through the bridge's resolver, which may open a transient preview
 * or hand the target to the installed app.
 */
export function useForwardOrigin(
  dialogs: readonly DialogDto[],
  openChat: (chat: ChatDto) => void,
  resolveTarget: (target: TelegramChatTarget) => void,
): (forward: MessageForwardDto) => void {
  return useCallback(
    (forward: MessageForwardDto): void => {
      const target = forwardOriginTarget(forward);
      if (target === null) return;
      const dialog = findLinkedChat(dialogs, target);
      if (dialog !== null) {
        openChat(dialog);
        return;
      }
      resolveTarget(target);
    },
    [dialogs, openChat, resolveTarget],
  );
}
