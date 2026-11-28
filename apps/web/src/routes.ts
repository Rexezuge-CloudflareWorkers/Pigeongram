import type { PeerId } from './types';

/**
The SPA's client routes and their URL grammar.

Kept pure, like the sibling apps' `lib/routes`, so the pathname ↔ route
mapping can be tested without a DOM. The one read of `location` and every
`history` write live in `useRouter`.

Chat ids are the bridge's marked ids: users and small groups are positive,
channels and supergroups negative, so both signs are valid. A post id is a
positive Telegram message id. Anything that does not match the grammar falls
back to the chat list, which keeps a stray or truncated URL from stranding
the app on an empty screen.

The archive is a screen of its own (`/archived`): the chats the account
archived, in the place Telegram keeps them.

Settings is a screen too (`/settings`), and each group has its own path
(`/settings/appearance`, `/settings/notifications`, `/settings/data`, `/settings/storage`), so the
browser's and the Android shell's back gesture step out one level at a time.
*/

const SETTINGS_SECTIONS = ['appearance', 'notifications', 'data', 'storage'] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route =
  | { view: 'list' }
  | { view: 'archived' }
  | { view: 'settings'; section: SettingsSection | null }
  | { view: 'chat'; chatId: PeerId; postId: number | null }
  | { view: 'comments'; chatId: PeerId; postId: number };

/**
What `useRouter` hands to its route handler: whether the caller asked to
re-read the target even when the route is unchanged (a Telegram link), and
the helper with which a handler can replace the current entry after finding
that the route cannot be opened (a deleted post, for example).
*/
export interface RouteApplyOptions {
  force: boolean;
  replaceTo: (route: Route) => void;
}

export function routeForPath(pathname: string): Route {
  const segments = pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decode);
  // The archive is its own screen: the chats the account archived, in the
  // place Telegram keeps them.
  if (segments.length === 1 && segments[0] === 'archived') return { view: 'archived' };
  if (segments[0] === 'settings') {
    // An unknown section falls back to the settings index rather than the
    // chat list: the screen is still reachable, and a mistyped path must not
    // drop the reader out of settings.
    if (segments.length === 1) return { view: 'settings', section: null };
    if (segments.length === 2) return { view: 'settings', section: settingsSection(segments[1]) };
    return { view: 'list' };
  }
  if (segments[0] !== 'chat' || segments.length < 2) return { view: 'list' };
  const chatId = peerId(segments[1]);
  if (chatId === null) return { view: 'list' };
  if (segments.length === 2) return { view: 'chat', chatId, postId: null };
  if (segments[2] !== 'post' || segments.length < 4) return { view: 'list' };
  const postId = positiveInt(segments[3]);
  if (postId === null) return { view: 'list' };
  if (segments.length === 4) return { view: 'chat', chatId, postId };
  if (segments.length === 5 && segments[4] === 'comments') return { view: 'comments', chatId, postId };
  return { view: 'list' };
}

export function pathForRoute(route: Route): string {
  if (route.view === 'list') return '/';
  if (route.view === 'archived') return '/archived';
  if (route.view === 'settings') return route.section === null ? '/settings' : `/settings/${route.section}`;
  if (route.view === 'chat') {
    return route.postId === null ? `/chat/${String(route.chatId)}` : `/chat/${String(route.chatId)}/post/${String(route.postId)}`;
  }
  return `/chat/${String(route.chatId)}/post/${String(route.postId)}/comments`;
}

export function sameRoute(left: Route, right: Route): boolean {
  if (left.view !== right.view) return false;
  if (left.view === 'list' || left.view === 'archived') return true;
  if (left.view === 'settings') return right.view === 'settings' && left.section === right.section;
  if (right.view === 'list' || right.view === 'archived' || right.view === 'settings') return false;
  return left.chatId === right.chatId && left.postId === right.postId;
}

/**
The route of a chat, of a linked post, or of a comments thread.

A chat without a post is the plain chat screen; a post without a comments
thread is the post's chat; a comment id names the thread itself.
*/
export function routeForChat(chatId: PeerId, postId: number | null, commentId?: number): Route {
  if (postId === null) return { view: 'chat', chatId, postId: null };
  if (commentId === undefined) return { view: 'chat', chatId, postId };
  return { view: 'comments', chatId, postId };
}

/**
The view one step up: a comment thread returns to its post's chat, a settings
section returns to the settings index, the archive returns to the chat list,
and a chat returns to the list. Used as the fallback when a history entry has
no in-app parent.
*/
export function parentRoute(route: Route): Route {
  if (route.view === 'comments') return { view: 'chat', chatId: route.chatId, postId: route.postId };
  if (route.view === 'settings' && route.section !== null) return { view: 'settings', section: null };
  return { view: 'list' };
}

function settingsSection(value: string | undefined): SettingsSection | null {
  return SETTINGS_SECTIONS.find((section) => section === value) ?? null;
}

function peerId(value: string | undefined): PeerId | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed !== 0 ? parsed : null;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
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
