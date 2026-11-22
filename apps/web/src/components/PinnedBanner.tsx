import { previewOf } from '../format';
import type { ChatDto, MessageDto } from '../types';
import { Icon } from './Icon';

/**
The bar under the thread header that names the chat's newest pinned message.

Telegram's own clients keep the pin above the messages and make it a door to
the pinned list. This one does the same: the bar is one button, and the list
is read only when the reader asks for it. The message body comes from the
thread controller, so a pin made on another device moves the bar live.
*/

interface PinnedBannerProps {
  chat: ChatDto;
  message: MessageDto;
  onOpen: () => void;
}

function senderOf(message: MessageDto, chat: ChatDto): string {
  if (message.outgoing) return 'You';
  return message.senderName ?? chat.title;
}

export function PinnedBanner({ chat, message, onOpen }: PinnedBannerProps) {
  return (
    <button
      type="button"
      className="flex w-full shrink-0 items-center gap-2.5 border-b border-outline-variant bg-surface-container px-4 py-2 text-left transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      onClick={onOpen}
      aria-label="Pinned messages"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
        <Icon name="pin" size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-primary">Pinned Message</span>
        <span className="block truncate text-sm text-on-surface-variant">
          <span className="font-medium text-on-surface">{senderOf(message, chat)}</span>
          {': '}
          {previewOf(message.text, message.media, message.poll)}
        </span>
      </span>
    </button>
  );
}
