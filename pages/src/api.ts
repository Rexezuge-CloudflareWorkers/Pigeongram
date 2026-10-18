import type {
  EngineStateDto,
  GetDialogsResult,
  GetHistoryResult,
  GetMeResult,
  PeerId,
  RpcMethod,
  SearchMessagesResult,
  SendMessageResult,
  SendReactionResult,
  UploadKind,
} from './types';

const TOKEN_KEY = 'telegram-web-client.token';

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

let token = readStoredToken();

export function getToken(): string {
  return token;
}

export function setToken(value: string): void {
  token = value.trim();
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Private-mode browsers can refuse storage; the in-memory token still works.
  }
}

function readStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
True when the failure is the token gate rejecting the session.
*/
export function isGateError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'gate');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers['x-session-token'] = token;
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

export const getState = (): Promise<EngineStateDto> => request<EngineStateDto>('/api/state');

export const startQr = (): Promise<EngineStateDto> => request<EngineStateDto>('/api/login/qr', { method: 'POST' });

export const startPhoneLogin = (phone: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/api/login/phone', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });

export const submitLoginCode = (code: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/api/login/code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

export const cancelLogin = (): Promise<EngineStateDto> => request<EngineStateDto>('/api/login/cancel', { method: 'POST' });

export const submitPassword = (password: string): Promise<EngineStateDto> =>
  request<EngineStateDto>('/api/login/password', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });

export const logout = (): Promise<{ ok: true }> => request('/api/logout', { method: 'POST' });

export const rpc = <T>(method: RpcMethod, params?: Record<string, unknown>): Promise<T> =>
  request<T>('/api/rpc', { method: 'POST', body: JSON.stringify({ method, params }) });

export const fetchDialogs = (): Promise<GetDialogsResult> => rpc('getDialogs', { limit: 100 });

export const fetchMe = (): Promise<GetMeResult> => rpc('getMe');

export const fetchHistory = (
  chatId: PeerId,
  options: { limit?: number; offsetId?: number; offsetDate?: number } = {},
): Promise<GetHistoryResult> => rpc('getHistory', { chatId, ...options });

export const sendMessage = (chatId: PeerId, text: string, replyTo?: number): Promise<SendMessageResult> =>
  rpc('sendMessage', { chatId, text, ...(replyTo !== undefined && { replyTo }) });

export const readHistory = (chatId: PeerId): Promise<unknown> => rpc('readHistory', { chatId });

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
  Id of the message being replied to, when the upload is a reply.
  */
  replyTo?: number;
  width?: number;
  height?: number;
  duration?: number;
}

/**
Uploads a file's bytes as the raw body of `POST /api/upload`.

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
  if (input.replyTo !== undefined) params.set('replyTo', String(input.replyTo));
  if (input.width !== undefined) params.set('width', String(input.width));
  if (input.height !== undefined) params.set('height', String(input.height));
  if (input.duration !== undefined) params.set('duration', String(input.duration));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?${params.toString()}`);
    if (token) xhr.setRequestHeader('x-session-token', token);
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

export function fileUrl(chatId: PeerId, messageId: number, options: { thumb?: boolean } = {}): string {
  const params = new URLSearchParams({ chatId: String(chatId), messageId: String(messageId) });
  if (options.thumb) params.set('thumb', '1');
  if (token) params.set('token', token);
  return `/api/file?${params.toString()}`;
}

export function avatarUrl(chatId: PeerId, version: string, size: 'small' | 'big' = 'small'): string {
  const params = new URLSearchParams({ chatId: String(chatId), size, v: version });
  if (token) params.set('token', token);
  return `/api/avatar?${params.toString()}`;
}

export function updatesSocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${location.host}/api/updates${suffix}`;
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
