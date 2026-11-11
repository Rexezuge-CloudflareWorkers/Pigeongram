import { Icon } from './Icon';

/**
The card a message renders when there is nothing this client can draw: its
media is a type newer than the engine's MTProto layer, or it arrived with no
text, media or preview at all.

Telegram answers a message whose media type the client's layer does not know
with `messageMediaUnsupported` and blanks its caption, so the bubble would
otherwise be a hole in the thread. Naming the gap and offering the post in
Telegram keeps the message readable as a placeholder — `docs/TELEGRAM_WIDGETS.md`
records why (Telegram Widgets, layer 233) and what a real implementation needs.
*/
export function MessageUnsupported({ link }: { link: string | null }) {
  return (
    <div
      className="unsupported-media flex items-start gap-3 rounded-xl border border-dashed border-outline-variant bg-surface-container p-3"
      data-unsupported-message
    >
      <span className="mt-0.5 shrink-0 text-on-surface-variant" aria-hidden="true">
        <Icon name="info" size={20} />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-medium text-on-surface">This Message Isn&apos;t Supported Yet</p>
        <p className="mt-0.5 text-on-surface-variant">It Uses A Newer Telegram Feature This App Can&apos;t Display.</p>
        {link === null ? null : (
          <a
            className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary hover:underline"
            href={link}
            target="_blank"
            rel="noreferrer"
          >
            Open In Telegram
            <Icon name="open-in-new" size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
