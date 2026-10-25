import { ApiError } from './api-error';
import { request } from './api/request';
import type { EngineStateDto } from './types';

/**
 * The bridge client's public surface: the Access and login plane lives here,
 * and the chat, thread and media calls are re-exported from the modules beside
 * `api/`. Screens keep importing `./api`; the split is about file size, not
 * about a second calling convention.
 */

export { ApiError } from './api-error';

export { fetchArchivedDialogs, fetchBootstrap, fetchDialogs, fetchProfile, setArchived } from './api/chats';
export {
  fetchChatScreen,
  fetchComments,
  fetchHistory,
  fetchPollResults,
  forwardMessages,
  pressCallbackButton,
  readHistory,
  searchMessages,
  sendComment,
  sendMessage,
  sendReaction,
  sendVote,
} from './api/threads';
export { rpc } from './api/request';
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
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

/**
Reads the engine snapshot, which doubles as the Access probe.

An Access login page can answer `200` with HTML when its redirect is followed
same-origin; the JSON parser yields `null`, which is not engine state. Throw a
non-`ApiError` so `useLoginFlow` treats it exactly like the cross-origin
redirect it stands in for.
*/
export async function getState(): Promise<EngineStateDto> {
  const state = await request<EngineStateDto | null>('/user/state', { cache: 'no-store' });
  if (state === null || typeof state.authorized !== 'boolean') {
    throw new TypeError('The /user/state response is not an engine snapshot');
  }
  return state;
}

export const startQr = (): Promise<EngineStateDto> => request<EngineStateDto>('/user/login/qr', { method: 'POST' });

export const startPhoneLogin = (phone: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/user/login/phone', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });

export const submitLoginCode = (code: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/user/login/code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

export const cancelLogin = (): Promise<EngineStateDto> => request<EngineStateDto>('/user/login/cancel', { method: 'POST' });

export const submitPassword = (password: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/user/login/password', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });

export const logout = (): Promise<{ ok: true }> => request('/user/logout', { method: 'POST' });

export function updatesSocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/user/updates`;
}

/**
One user-visible-string decision point shared by the login screen.
*/
export function loginPhaseMessage(state: EngineStateDto | null): string {
  if (!state) return 'Connecting to the session engine…';
  switch (state.phase) {
    case 'qr': {
      return 'Scan this QR code from Telegram: Settings → Devices → Link Desktop Device';
    }
    case 'scanned': {
      return 'QR code accepted — finishing sign-in…';
    }
    case 'code': {
      const where = state.codeType ? CODE_DELIVERY[state.codeType] : undefined;
      return where ? `Telegram sent a login code ${where} — type it below` : 'Type the login code Telegram sent you';
    }
    case 'password': {
      return 'Two-step verification: enter your Telegram cloud password';
    }
    case 'error': {
      return state.error ?? 'The session engine reported an error';
    }
    default: {
      return 'Preparing a login QR code…';
    }
  }
}

const CODE_DELIVERY: Record<string, string> = {
  app: 'to your Telegram app',
  sms: 'by SMS',
  call: 'in a phone call',
  flash_call: 'as a flash call',
  missed_call: 'as a missed call',
  email: 'by email',
  firebase: 'by SMS',
  fragment: 'by SMS',
  sms_word: 'by SMS',
  sms_phrase: 'by SMS',
};

export { type UpdateEvent } from './types';
