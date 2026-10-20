import type {
  EngineStateDto,
  GetBotCommandsResult,
  GetCommentsResult,
  GetDialogsResult,
  GetHistoryResult,
  GetMeResult,
  GetPollResultsResult,
  PeerId,
  PressCallbackButtonResult,
  RpcMethod,
  SearchMessagesResult,
  SendCommentResult,
  SendMessageResult,
  SendReactionResult,
  SendVoteResult,
  UploadKind,
} from './types';

/**
An HTTP failure from the bridge, carrying the engine's error payload.
*/
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
The Cloudflare Access entry point.

A top-level navigation here makes Access run its login flow, after which the
worker redirects back into the SPA. Keeping it in one place also keeps the
Pages Function prefix (`/user/*`) and the worker route in step.
*/
export const ACCESS_LOGIN_PATH = '/user/login';

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['content-type'] = 'application/json';

  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw apiError(response.status, payload);
  }
  return payload as T;
}

/**
Turns a bridge error payload (or a proxy/platform failure) into an `ApiError`.
*/
function apiError(status: number, payload: unknown): ApiError {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return new ApiError(
    typeof record.error === 'string' ? record.error : `Request failed (${status})`,
    status,
    typeof record.code === 'string' ? record.code : undefined,
  );
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

export const rpc = <T>(method: RpcMethod, params?: Record<string, unknown>): Promise<T> =>
  request<T>('/user/rpc', { method: 'POST', body: JSON.stringify({ method, params }) });

export const fetchDialogs = (): Promise<GetDialogsResult> => rpc('getDialogs', { limit: 100 });

export const fetchMe = (): Promise<GetMeResult> => rpc('getMe');

export const fetchHistory = (
  chatId: PeerId,
  options: { limit?: number; offsetId?: number; offsetDate?: number; addOffset?: number } = {},
): Promise<GetHistoryResult> => rpc('getHistory', { chatId, ...options });

export const sendMessage = (chatId: PeerId, text: string, replyTo?: number): Promise<SendMessageResult> =>
  rpc('sendMessage', { chatId, text, ...(replyTo !== undefined && { replyTo }) });

export const readHistory = (chatId: PeerId, maxId?: number): Promise<unknown> =>
  rpc('readHistory', { chatId, ...(maxId !== undefined && { maxId }) });

export const fetchComments = (
  chatId: PeerId,
  messageId: number,
  options: { limit?: number; offsetId?: number; offsetDate?: number } = {},
): Promise<GetCommentsResult> => rpc('getComments', { chatId, messageId, ...options });

export const sendComment = (chatId: PeerId, messageId: number, text: string, replyTo?: number): Promise<SendCommentResult> =>
  rpc('sendComment', { chatId, messageId, text, ...(replyTo !== undefined && { replyTo }) });

/**
Reads the slash-command menu Telegram offers for a chat: a bot's own commands
in a private chat, or the aggregate of the group's bots.
*/
export const fetchBotCommands = (chatId: PeerId): Promise<GetBotCommandsResult> => rpc('getBotCommands', { chatId });

export const searchMessages = (chatId: PeerId, query: string): Promise<SearchMessagesResult> =>
  rpc('searchMessages', { chatId, query, limit: 50 });

export interface UploadInput {
  chatId: PeerId;
  kind: UploadKind;
  fileName: string;
  mime: string;
  size: number;
  caption?: string;
  /**
  Id of the channel post being commented on, when the upload is a comment.
  */
  commentTo?: number;
  /**
  Id of the message being replied to: a comment when `commentTo` is set,
  otherwise a message in `chatId`.
  */
  replyTo?: number;
  width?: number;
  height?: number;
  duration?: number;
}

/**
Uploads a file's bytes as the raw body of `POST /user/upload`.

XHR, unlike `fetch`, reports upload progress; the promise resolves once the
engine has sent the message (after the Telegram-side upload), so the last
stretch is only visible as an indeterminate state.
*/
export function uploadFile(input: UploadInput, body: Blob, onProgress?: (fraction: number) => void): Promise<SendMessageResult> {
  const params = new URLSearchParams({
    chatId: String(input.chatId),
    kind: input.kind,
    fileName: input.fileName,
    mime: input.mime,
    size: String(input.size),
  });
  if (input.caption) params.set('caption', input.caption);
  if (input.commentTo !== undefined) params.set('commentTo', String(input.commentTo));
  if (input.replyTo !== undefined) params.set('replyTo', String(input.replyTo));
  if (input.width !== undefined) params.set('width', String(input.width));
  if (input.height !== undefined) params.set('height', String(input.height));
  if (input.duration !== undefined) params.set('duration', String(input.duration));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/user/upload?${params.toString()}`);
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    });
    xhr.addEventListener('load', () => {
      const payload = xhr.response as unknown;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as SendMessageResult);
        return;
      }
      reject(apiError(xhr.status, payload));
    });
    xhr.addEventListener('error', () => reject(new ApiError('Upload failed — network error', 0)));
    xhr.addEventListener('abort', () => reject(new ApiError('Upload cancelled', 0)));
    xhr.send(body);
  });
}

/**
Sets (or, with `null`, removes) the current user's reaction on a message.
Custom emoji reactions are addressed by their decimal document id.
*/
export const sendReaction = (
  chatId: PeerId,
  messageId: number,
  reaction: { emoji?: string } | { customEmojiId: string } | null,
): Promise<SendReactionResult> =>
  rpc('sendReaction', {
    chatId,
    messageId,
    emoji: reaction && 'emoji' in reaction ? reaction.emoji : null,
    customEmojiId: reaction && 'customEmojiId' in reaction ? reaction.customEmojiId : null,
  });

/**
Casts (or, with `null`, retracts) a vote in a poll: the indexes name answers in
the order the message carries them. The engine resolves the indexes against
the live poll, so a stale message can never send a wrong option's bytes.
*/
export const sendVote = (chatId: PeerId, messageId: number, options: number[] | null): Promise<SendVoteResult> =>
  rpc('sendVote', { chatId, messageId, options });

/**
Presses an inline callback button. The payload is the base64 string the
message's button carried; the bridge decodes it and forwards it unchanged.
*/
export const pressCallbackButton = (chatId: PeerId, messageId: number, data: string): Promise<PressCallbackButtonResult> =>
  rpc('pressCallbackButton', { chatId, messageId, data });

/**
Re-reads a poll the bridge could only announce (a short update): the answer is
the same DTO `sendVote` returns, so the caller folds it in the same way.
*/
export const fetchPollResults = (chatId: PeerId, messageId: number): Promise<GetPollResultsResult> =>
  rpc('getPollResults', { chatId, messageId });

export function fileUrl(chatId: PeerId, messageId: number, options: { thumb?: boolean } = {}): string {
  const params = new URLSearchParams({ chatId: String(chatId), messageId: String(messageId) });
  if (options.thumb) params.set('thumb', '1');
  return `/user/file?${params.toString()}`;
}

export function avatarUrl(chatId: PeerId, version: string, size: 'small' | 'big' = 'small'): string {
  const params = new URLSearchParams({ chatId: String(chatId), size, v: version });
  return `/user/avatar?${params.toString()}`;
}

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
