import { renderMessageText } from '../richtext';
import type { RichTextHandlers } from '../richtext';
import { useHashtagHandler, useTelegramLinkHandler } from '../telegram-links';
import type { MessageEntityDto } from '../types';

/**
 * A message body's rich text, with its links and hashtags routed by the app
 * (see `telegram-links.tsx`): Telegram links open a chat here or hand off to
 * the installed app, a hashtag opens a search for it, ordinary links keep
 * their default new-tab behavior.
 */
export function MessageText({ text, entities }: { text: string; entities: MessageEntityDto[] }) {
  const link = useTelegramLinkHandler();
  const hashtag = useHashtagHandler();
  const handlers: RichTextHandlers = {
    ...(link !== null && { onLinkClick: link }),
    ...(hashtag !== null && { onHashtagClick: hashtag }),
  };
  return <>{renderMessageText(text, entities, link === null && hashtag === null ? undefined : handlers)}</>;
}
