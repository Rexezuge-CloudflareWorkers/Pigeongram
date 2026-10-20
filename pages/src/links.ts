import type { ChatDto, DialogDto } from './types';

/**
 * Telegram links and the handoff to the installed app.
 *
 * A `t.me/...` URL and a `tg://...` deep link describe the same things — a
 * chat, one of its posts, an invite, a sticker set — so both are normalized
 * here into one target: what the link names (if this client could already know
 * it), the `tg://` URL that opens it in the native app, and the canonical
 * https URL a browser can fall back to. Pure, so the grammar and the handoff
 * can be tested without a browser.
 *
 * An unknown `tg://` operation passes through untouched: the app is the only
 * thing that can make sense of it.
 */

/**
 * The chat a link names: a public username, or the raw id of a private
 * channel (`t.me/c/<id>`, which the bridge addresses in its marked form).
 */
export type TelegramChatRef = { username: string } | { internalId: number };

export interface TelegramLink {
  /**
   * The chat the link names, or null for link kinds that name no chat (an
   * invite, a sticker set, an unknown `tg://` operation).
   */
  chat: TelegramChatRef | null;
  /**
   * The post (message) id the link points at, or null.
   */
  postId: number | null;
  /**
   * The comment id inside the linked post's discussion thread, or null.
   */
  commentId: number | null;
  /**
   * The `tg://` URL that opens the link in the installed app.
   */
  deepLink: string;
  /**
   * The canonical https URL, when the link has one; the no-app fallback.
   * Private-channel and unknown links have no https equivalent.
   */
  webUrl: string | null;
}

/**
 * How long the app has to take over before the browser fallback opens.
 */
export const APP_LAUNCH_TIMEOUT_MS = 2500;

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog']);

/**
 * Paths that are Telegram operations rather than usernames, so a stray
 * `t.me/share` never resolves to an account.
 */
const RESERVED = new Set(['c', 's', 'share', 'proxy', 'socks', 'joinchat', 'addstickers', 'addemoji', 'iv', 'bg', 'setlanguage']);

const USERNAME = /^[a-z][a-z0-9_]{2,31}$/;

/**
 * Parses a `t.me` URL or a `tg://` deep link into one target. Returns null for
 * anything else — the link is not Telegram's, so the browser keeps it.
 */
export function parseTelegramLink(raw: string): TelegramLink | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const scheme = /^([a-z][\d+.a-z-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme === 'tg') return parseDeepLink(trimmed);
  if (scheme !== 'http' && scheme !== 'https') return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!TELEGRAM_HOSTS.has(url.hostname.toLowerCase().replace(/^www\./, ''))) return null;
  return parseWebPath(url);
}

/**
 * Converts a Telegram Mini App web link (`t.me/<bot>?startapp…` or
 * `t.me/<bot>/<short_name>…`) into the `tg://resolve` deep link the installed
 * app understands. Returns null for every other URL, including a plain bot
 * chat link without `startapp`.
 *
 * Inline web-view buttons cannot work in this browser client: a Mini App needs
 * Telegram's signed `initData`, which only Telegram itself can inject. Handing
 * the link to the installed app is the one path that keeps the app functional.
 */
export function miniAppDeepLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!TELEGRAM_HOSTS.has(url.hostname.toLowerCase().replace(/^www\./, ''))) return null;

  const segments = url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => decode(segment));
  const [first, second, third] = segments;
  if (first === undefined) return null;
  const username = usernameOf(first);
  if (username === null || RESERVED.has(first.toLowerCase())) return null;

  const params: string[] = [`domain=${encodeURIComponent(username)}`];
  if (second !== undefined) {
    // A direct Mini App link names the app in the path; a numeric segment is a
    // post rather than an app.
    if (third !== undefined || /^\d+$/.test(second)) return null;
    if (!/^\w{1,64}$/i.test(second)) return null;
    params.push(`appname=${encodeURIComponent(second)}`);
  } else if (!url.searchParams.has('startapp')) {
    // Without `startapp`, `t.me/<bot>` is an ordinary chat link, not a Main
    // Mini App link.
    return null;
  }

  if (url.searchParams.has('startapp')) {
    const startapp = url.searchParams.get('startapp') ?? '';
    params.push(startapp === '' ? 'startapp' : `startapp=${encodeURIComponent(startapp)}`);
  }
  const mode = url.searchParams.get('mode');
  if (mode === 'compact' || mode === 'fullscreen') params.push(`mode=${mode}`);
  return `tg://resolve?${params.join('&')}`;
}

/**
 * The dialog a link names, when the account already has it: usernames are
 * matched case-insensitively, private-channel ids through their marked form.
 */
export function findLinkedChat(dialogs: readonly DialogDto[], chat: TelegramChatRef): ChatDto | null {
  if ('username' in chat) {
    const wanted = chat.username.toLowerCase();
    return dialogs.find((dialog) => dialog.chat.username?.toLowerCase() === wanted)?.chat ?? null;
  }
  const wanted = markedChatId(chat.internalId);
  return dialogs.find((dialog) => dialog.chat.id === wanted)?.chat ?? null;
}

/**
 * The marked (bridge) id of a channel or megagroup from the raw id a
 * `t.me/c/...` link carries.
 */
export function markedChatId(internalId: number): number {
  return -(1_000_000_000_000 + internalId);
}

/**
 * Opens a `tg://` link in the installed app, falling back to the canonical
 * https URL when nothing takes over.
 *
 * The deep link is loaded in a hidden iframe: a browser with a handler for the
 * scheme shows its "open in app" prompt without navigating away, and one
 * without a handler does nothing, so this page is never clobbered. The tab
 * losing focus or visibility within the timeout proves the app took over;
 * otherwise the https URL opens in a new tab (popup blockers permitting).
 */
export function launchTelegramApp(deepLink: string, webUrl: string | null): void {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = deepLink;
  // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
  document.body.appendChild(frame);

  const timer = setTimeout(() => {
    stop();
    if (webUrl !== null) window.open(webUrl, '_blank', 'noopener,noreferrer');
  }, APP_LAUNCH_TIMEOUT_MS);

  // Hoisted, so the timer callback and the listeners below can share it.
  function stop(): void {
    clearTimeout(timer);
    window.removeEventListener('blur', stop);
    document.removeEventListener('visibilitychange', onVisibility);
    frame.remove();
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') stop();
  }

  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', onVisibility);
}

function parseWebPath(url: URL): TelegramLink | null {
  const segments = url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => decode(segment));
  // `t.me/s/<name>[/<post>]` is the channel-preview page: the same target.
  if (segments[0] === 's') segments.shift();
  const [first, second, third] = segments;
  if (first === undefined) return null;

  if (first === 'c' && second !== undefined) {
    const internalId = positiveInt(second);
    const postId = third === undefined ? null : positiveInt(third);
    if (internalId === null || (third !== undefined && postId === null)) return null;
    return privatePost(internalId, postId);
  }
  if (first === 'joinchat' && second !== undefined) return invite(second);
  if (first.startsWith('+') && first.length > 1) return invite(first.slice(1));
  if (first === 'addstickers' && second !== undefined) return stickerSet(second);

  const username = usernameOf(first);
  if (username === null) return null;
  if (second === undefined) return chatLink(username, null, null);
  const postId = positiveInt(second);
  if (postId === null) return null; // /share/url, /proxy, … stay external links
  return chatLink(username, postId, positiveInt(url.searchParams.get('comment')));
}

function parseDeepLink(raw: string): TelegramLink {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return passthrough(raw);
  }
  const params = url.searchParams;
  switch (url.hostname.toLowerCase()) {
    case 'resolve': {
      const username = usernameOf(params.get('domain') ?? '');
      if (username === null) return passthrough(raw);
      return chatLink(username, positiveInt(params.get('post')), positiveInt(params.get('comment')));
    }
    case 'privatepost': {
      const internalId = positiveInt(params.get('channel'));
      if (internalId === null) return passthrough(raw);
      return privatePost(internalId, positiveInt(params.get('post')));
    }
    case 'join': {
      const hash = params.get('invite');
      return hash === null || hash === '' ? passthrough(raw) : invite(hash);
    }
    case 'addstickers': {
      const name = params.get('set');
      return name === null || name === '' ? passthrough(raw) : stickerSet(name);
    }
    default: {
      return passthrough(raw);
    }
  }
}

function chatLink(username: string, postId: number | null, commentId: number | null): TelegramLink {
  const params = new URLSearchParams({ domain: username });
  const comment = postId !== null && commentId !== null ? commentId : null;
  if (postId !== null) params.set('post', String(postId));
  if (comment !== null) params.set('comment', String(comment));
  const path = postId === null ? '' : `/${String(postId)}`;
  const query = comment === null ? '' : `?comment=${String(comment)}`;
  return {
    chat: { username },
    postId,
    commentId: comment,
    deepLink: `tg://resolve?${params.toString()}`,
    webUrl: `https://t.me/${username}${path}${query}`,
  };
}

function privatePost(internalId: number, postId: number | null): TelegramLink {
  const params = new URLSearchParams({ channel: String(internalId) });
  if (postId !== null) params.set('post', String(postId));
  return {
    chat: { internalId },
    postId,
    commentId: null,
    deepLink: `tg://privatepost?${params.toString()}`,
    webUrl: null,
  };
}

function invite(hash: string): TelegramLink {
  return {
    chat: null,
    postId: null,
    commentId: null,
    deepLink: `tg://join?invite=${encodeURIComponent(hash)}`,
    webUrl: `https://t.me/+${hash}`,
  };
}

function stickerSet(name: string): TelegramLink {
  return {
    chat: null,
    postId: null,
    commentId: null,
    deepLink: `tg://addstickers?set=${encodeURIComponent(name)}`,
    webUrl: `https://t.me/addstickers/${name}`,
  };
}

function passthrough(raw: string): TelegramLink {
  return { chat: null, postId: null, commentId: null, deepLink: raw, webUrl: null };
}

function usernameOf(value: string): string | null {
  const name = value.toLowerCase();
  if (RESERVED.has(name) || !USERNAME.test(name)) return null;
  return name;
}

function positiveInt(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
