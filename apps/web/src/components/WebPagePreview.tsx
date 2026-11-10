import { useState } from 'react';
import { fileUrl } from '../api';
import { useTelegramLinkHandler } from '../telegram-links';
import type { MessageDto, MessageWebPageDto } from '../types';

/**
A link preview below a message's text: Telegram's card for the page.

The whole card is one anchor, and the click goes through the app's link router
first: a Telegram link opens in the thread (or hands off to the installed app),
while an ordinary link keeps its new-tab default. The image is Telegram's own
copy, served by `/user/file` — the browser never contacts the linked page, so a
preview leaks nothing to the site until the card is opened.

`displaySize` is Telegram's layout hint: `small` keeps the thumbnail beside the
text, `large` (and the default) puts it above. A page without a photo, or one
whose photo fails to load, keeps the text card.
*/
export function MessageWebPage({ message, page }: { message: MessageDto; page: MessageWebPageDto }) {
  const link = useTelegramLinkHandler();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Only a web URL is a safe card target. The engine filters these already;
  // the guard keeps a malformed bridge payload from becoming a live link.
  if (!/^https?:\/\//i.test(page.url)) return null;

  const small = page.displaySize === 'small';
  const photo = page.photo;
  const src = photo === null ? null : fileUrl(message.chatId, message.id, { version: photo.id });
  const thumbnail =
    photo === null || src === null || failedSrc === src ? null : (
      <img
        src={src}
        alt=""
        width={photo.width}
        height={photo.height}
        loading="lazy"
        className={small ? 'h-16 w-16 shrink-0 rounded object-cover' : 'max-h-60 w-full rounded object-cover'}
        onError={() => setFailedSrc(src)}
      />
    );

  return (
    <a
      href={page.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex gap-2 rounded-md border-l-2 border-accent bg-black/20 p-2 text-fg no-underline hover:bg-black/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        small ? 'flex-row-reverse items-start' : 'flex-col'
      }`}
      onClick={(event) => {
        if (link?.(page.url)) event.preventDefault();
      }}
    >
      {thumbnail}
      <span className="flex min-w-0 flex-col gap-0.5">
        {page.siteName === null ? null : <span className="truncate text-xs font-medium text-accent">{page.siteName}</span>}
        {page.title === null ? null : <span className="line-clamp-2 text-sm font-semibold">{page.title}</span>}
        {page.description === null ? null : <span className="line-clamp-3 text-xs text-muted">{page.description}</span>}
        <span className="truncate text-xs text-muted">{page.displayUrl}</span>
      </span>
    </a>
  );
}
