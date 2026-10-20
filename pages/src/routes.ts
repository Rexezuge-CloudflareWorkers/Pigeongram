import type { PeerId } from './types';

/**
 * The SPA's client routes and their URL grammar.
 *
 * Kept pure, like the sibling apps' `lib/routes`, so the pathname ↔ route
 * mapping can be tested without a DOM. The one read of `location` and every
 * `history` write live in `useRouter`.
 *
 * Chat ids are the bridge's marked ids: users and small groups are positive,
 * channels and supergroups negative, so both signs are valid. A post id is a
 * positive Telegram message id. Anything that does not match the grammar falls
 * back to the chat list, which keeps a stray or truncated URL from stranding
 * the app on an empty screen.
 */

export type Route =
  { view: 'list' } | { view: 'chat'; chatId: PeerId; postId: number | null } | { view: 'comments'; chatId: PeerId; postId: number };

/**
 * What `useRouter` hands to its route handler: whether the caller asked to
 * re-read the target even when the route is unchanged (a Telegram link), and
 * the helper with which a handler can replace the current entry after finding
 * that the route cannot be opened (a deleted post, for example).
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
  if (route.view === 'chat') {
    return route.postId === null ? `/chat/${String(route.chatId)}` : `/chat/${String(route.chatId)}/post/${String(route.postId)}`;
  }
  return `/chat/${String(route.chatId)}/post/${String(route.postId)}/comments`;
}

export function sameRoute(left: Route, right: Route): boolean {
  if (left.view !== right.view) return false;
  if (left.view === 'list') return true;
  if (right.view === 'list') return false;
  return left.chatId === right.chatId && left.postId === right.postId;
}

/**
 * The view one step up: a comment thread returns to its post's chat, and a
 * chat returns to the list. Used as the fallback when a history entry has no
 * in-app parent.
 */
export function parentRoute(route: Route): Route {
  if (route.view === 'comments') return { view: 'chat', chatId: route.chatId, postId: route.postId };
  return { view: 'list' };
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
