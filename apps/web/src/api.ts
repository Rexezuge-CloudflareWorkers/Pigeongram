import { ServiceError } from '@rexezuge/errors';
import { HttpStatusError } from '@rexezuge/web/api';
import { request } from './api/request';
import type { EngineStateDto } from './types';

/**
The bridge client's public surface: the Access and login plane lives here,
and the chat, thread and media calls are re-exported from the modules beside
`api/`. Screens keep importing `./api`; the split is about file size, not
about a second calling convention.
*/

export {
  fetchArchivedDialogs,
  fetchBootstrap,
  fetchDialogs,
  fetchProfile,
  joinChat,
  joinInvite,
  resolveChat,
  resolveInvite,
  searchContacts,
  setArchived,
  setPinned,
} from './api/chats';
export {
  deleteMessages,
  deleteScheduledMessages,
  editMessage,
  fetchChatScreen,
  fetchComments,
  fetchHistory,
  fetchPinnedMessages,
  fetchPollResults,
  fetchScheduledMessages,
  forwardMessages,
  pressCallbackButton,
  readHistory,
  sendComment,
  sendMessage,
  sendReaction,
  sendScheduled,
  sendVote,
  setMessagePinned,
} from './api/threads';
export { searchGlobal, searchMessages } from './api/search';
export { fetchStickerLibrary, fetchStickerSet, installStickerSet, sendSticker, stickerUrl } from './api/stickers';
export { rpc } from './api/request';
export { subscribePush, unsubscribePush } from './api/push';
export { avatarUrl, fileUrl, uploadFile, uploadGroup } from './api/uploads';
export type { UploadGroupInput, UploadGroupItem, UploadInput } from './api/uploads';

/**
The Cloudflare Access entry point.

A top-level navigation here makes Access run its login flow, after which the
worker redirects back into the SPA. Keeping it in one place also keeps the
Pages Function prefix (`/user/*`) and the worker route in step.
*/
const ACCESS_LOGIN_PATH = '/user/login';

/**
Builds the Access entry URL for a same-origin return path.

`/` stays a bare link; every other path rides through the Access round-trip as
`next`, so a bookmarked chat link survives the login.
*/
export function accessLoginUrl(returnTo: string): string {
  return returnTo === '/' ? ACCESS_LOGIN_PATH : `${ACCESS_LOGIN_PATH}?next=${encodeURIComponent(returnTo)}`;
}

/**
True when the front door rejected the caller's Cloudflare Access session.

Access normally handles this at the edge and shows its login page; a 401/403
here means the worker did not receive a valid assertion, so the page falls
back to the public intro.
*/
export function isAuthError(error: unknown): boolean {
  return error instanceof ServiceError && (error.status === 401 || error.status === 403);
}

/**
Reads the engine snapshot, which doubles as the Access probe.

An Access login page can answer `200` with HTML when its redirect is followed
same-origin; the shared client reports that as a malformed-body
`HttpStatusError`, which is not engine state. A request that never produced a
response at all (the Access redirect's CORS failure, or a dead network)
arrives wrapped in a `ServiceError`. Both become a `TypeError` so
`useLoginFlow` can treat them exactly like the cross-origin redirect they
stand in for, and still distinguish them from a bridge error.
*/
export async function getState(): Promise<EngineStateDto> {
  let state: EngineStateDto | undefined;
  try {
    state = await request<EngineStateDto | undefined>('/user/state', { cache: 'no-store' });
  } catch (failure) {
    if (failure instanceof HttpStatusError && failure.status === 200) {
      throw new TypeError('The /user/state response is not an engine snapshot');
    }
    if (failure instanceof ServiceError && failure.cause instanceof TypeError) {
      throw failure.cause;
    }
    throw failure;
  }
  if (!state || typeof state.authorized !== 'boolean') {
    throw new TypeError('The /user/state response is not an engine snapshot');
  }
  return state;
}

export const startQr = (): Promise<EngineStateDto> => request<EngineStateDto>('/user/login/qr', { method: 'POST' });

export const startPhoneLogin = (phone: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/user/login/phone', {
    method: 'POST',
    body: { phone },
  });

export const submitLoginCode = (code: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/user/login/code', {
    method: 'POST',
    body: { code },
  });

export const cancelLogin = (): Promise<EngineStateDto> => request<EngineStateDto>('/user/login/cancel', { method: 'POST' });

export const submitPassword = (password: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/user/login/password', {
    method: 'POST',
    body: { password },
  });

export const logout = (): Promise<{ ok: true }> => request('/user/logout', { method: 'POST' });

export function updatesSocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/user/updates`;
}
