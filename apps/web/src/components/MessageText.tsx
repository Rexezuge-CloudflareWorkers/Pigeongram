import { renderMessageText } from '../richtext';
import { useTelegramLinkHandler } from '../telegram-links';
import type { MessageEntityDto } from '../types';

/**
 * A message body's rich text, with its links routed by the app (see
 * `telegram-links.tsx`): Telegram links open a chat here or hand off to the
 * installed app, ordinary links keep their default new-tab behavior.
 */
export function MessageText({ text, entities }: { text: string; entities: MessageEntityDto[] }) {
  const handler = useTelegramLinkHandler();
  return <>{renderMessageText(text, entities, handler ?? undefined)}</>;
}
