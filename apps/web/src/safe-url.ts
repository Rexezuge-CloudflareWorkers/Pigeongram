/**
One URL allowlist for everything a bot or Telegram puts in a message.

Inline keyboards, reply keyboards, callback answers and rich-text entities
all carry URLs the reader did not type. Rendering one as an anchor or passing
it to `window.open` without a scheme check turns a message into a navigation
instruction. `javascript:` and `data:` must become inert text; `http(s)`,
`mailto`, `tel` and `tg` are the schemes the app actually knows how to open.

The check is on the trimmed string rather than a parsed `URL`: a relative
URL is not a valid target for a link that claims to leave the app, and
surrounding whitespace is a common payload from hand-written bot markup.
*/
const SAFE_SCHEME = /^(?:https?|mailto|tel|tg):/i;

/**
The URL when it is safe to render or open, otherwise `null`.
*/
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  return SAFE_SCHEME.test(trimmed) ? trimmed : null;
}
