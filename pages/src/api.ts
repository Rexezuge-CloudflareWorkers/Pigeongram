import type {
  EngineStateDto,
  GetDialogsResult,
  GetHistoryResult,
  GetMeResult,
  PeerId,
  RpcMethod,
  SearchMessagesResult,
  SendMessageResult,
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
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    throw new ApiError(
      typeof record.error === 'string' ? record.error : `Request failed (${response.status})`,
      response.status,
      typeof record.code === 'string' ? record.code : undefined,
    );
  }
  return payload as T;
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

export const sendMessage = (chatId: PeerId, text: string): Promise<SendMessageResult> => rpc('sendMessage', { chatId, text });

export const readHistory = (chatId: PeerId): Promise<unknown> => rpc('readHistory', { chatId });

export const searchMessages = (chatId: PeerId, query: string): Promise<SearchMessagesResult> =>
  rpc('searchMessages', { chatId, query, limit: 50 });

export function fileUrl(chatId: PeerId, messageId: number): string {
  const params = new URLSearchParams({ chatId: String(chatId), messageId: String(messageId) });
  if (token) params.set('token', token);
  return `/api/file?${params.toString()}`;
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
