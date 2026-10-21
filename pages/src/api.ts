import { ApiError, apiError } from './api-error';
import type {
  BotCommandDto,
  DialogDto,
  EngineStateDto,
  ForwardMessagesResult,
  GetBotCommandsResult,
  GetCommentsResult,
  GetDialogsResult,
  GetHistoryResult,
  GetMeResult,
  GetPollResultsResult,
  MeDto,
  MessageDto,
  PeerId,
  PressCallbackButtonResult,
  RpcBatchCall,
  RpcBatchOutcome,
  RpcMethod,
  SearchMessagesResult,
  SendCommentResult,
  SendMessageResult,
  SendReactionResult,
  SendVoteResult,
} from './types';

export { ApiError } from './api-error';
export type { UploadGroupInput, UploadGroupItem, UploadInput } from './upload-api';
export { uploadFile, uploadGroup } from './upload-api';

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

export const rpc = <T>(method: RpcMethod | 'batch', params?: Record<string, unknown>): Promise<T> =>
  request<T>('/user/rpc', { method: 'POST', body: JSON.stringify({ method, params }) });

/**
Runs several read-only calls in one request.

The session engine is a Durable Object, and a Durable Object hands out one
event at a time: two separate requests would queue behind each other, and
each Telegram round trip would be paid in turn. One batch is one event, and
the calls inside it run concurrently over the same Telegram connection.

Only the read-only methods may be batched. A write would have no defined
completion order, and Telegram's own ordering guarantees matter more than the
round trip saved.
*/
export async function rpcBatch(calls: readonly RpcBatchCall[]): Promise<RpcBatchOutcome[]> {
  const response = await rpc<{ results: RpcBatchOutcome[] }>('batch', { calls });
  return response.results;
}

/**
The result of one batched call, or a thrown failure.
*/
function batchResult<T>(outcome: RpcBatchOutcome | undefined, what: string): T {
  if (!outcome || !outcome.ok) {
    throw new ApiError(outcome?.error ?? `The ${what} could not be read`, 500);
  }
  return outcome.result as T;
}

export const fetchDialogs = (): Promise<GetDialogsResult> => rpc('getDialogs', { limit: 100 });

/**
The signed-in shell's first read: who the account is and the chat list.

Both come back in one request, and the account's own profile is a failure
that must not cost the chat list: the shell shows the chat list either way.
*/
export async function fetchBootstrap(): Promise<{ me: MeDto | null; dialogs: DialogDto[] }> {
  const outcomes = await rpcBatch([{ method: 'getMe' }, { method: 'getDialogs', params: { limit: 100 } }]);
  const me = outcomes[0]?.ok ? (outcomes[0].result as GetMeResult).me : null;
  const dialogs = batchResult<GetDialogsResult>(outcomes[1], 'chat list').dialogs;
  return { me, dialogs };
}

/**
Everything a chat screen needs, read in one request.
*/
export interface ChatScreen {
  /**
  The chat's first window.
  */
  messages: MessageDto[];
  /**
  The chat's slash commands, empty for a chat without one.
  */
  commands: BotCommandDto[];
  /**
  The post's comments, when a post was named. Null when the read failed —
  a post without a comments section is not a failure of the window beside it.
  */
  comments: GetCommentsResult | null;
  /**
  Why the comments could not be read, when they could not.
  */
  commentsError: string | null;
}

/**
 * Reads a chat screen: the window, the chat's slash commands and — when a
 * post is named — the post's comment thread.
 *
 * The reads are independent, so they travel together: one request, one
 * Durable Object event, and the Telegram calls inside it run at the same time
 * over the one connection.
 */
export async function fetchChatScreen(
  chatId: PeerId,
  postId: number | null = null,
  options: { limit?: number; anchorId?: number; withCommands?: boolean; commentsLimit?: number } = {},
): Promise<ChatScreen> {
  const { withCommands = false, commentsLimit = 50, ...history } = options;
  const calls: RpcBatchCall[] = [{ method: 'getHistory', params: { chatId, ...history } }];
  if (withCommands) {
    calls.push({ method: 'getBotCommands', params: { chatId } });
  }
  if (postId !== null) {
    calls.push({ method: 'getComments', params: { chatId, messageId: postId, limit: commentsLimit } });
  }
  const outcomes = await rpcBatch(calls);
  const messages = batchResult<GetHistoryResult>(outcomes[0], 'chat history').messages;
  // A chat without a command menu is normal, and a failed lookup is no
  // worse than an empty one: the composer simply offers no menu.
  const commands = outcomes[1]?.ok ? (outcomes[1].result as GetBotCommandsResult).commands : [];
  const commentsOutcome = postId === null ? undefined : outcomes[2];
  return {
    messages,
    commands,
    comments: commentsOutcome?.ok ? (commentsOutcome.result as GetCommentsResult) : null,
    commentsError: commentsOutcome === undefined || commentsOutcome.ok ? null : (commentsOutcome.error ?? 'The comments could not be read'),
  };
}

export const fetchHistory = (
  chatId: PeerId,
  options: { limit?: number; offsetId?: number; offsetDate?: number; addOffset?: number; anchorId?: number } = {},
): Promise<GetHistoryResult> => rpc('getHistory', { chatId, ...options });

export const sendMessage = (chatId: PeerId, text: string, replyTo?: number, randomId?: string): Promise<SendMessageResult> =>
  rpc('sendMessage', {
    chatId,
    text,
    ...(replyTo !== undefined && { replyTo }),
    ...(randomId !== undefined && { randomId }),
  });

/**
Forwards messages from their source chat into another chat. An album sends
its members as one batch; the engine returns the copies in the destination.
*/
export const forwardMessages = (chatId: PeerId, messageIds: number[], toChatId: PeerId): Promise<ForwardMessagesResult> =>
  rpc('forwardMessages', { chatId, messageIds, toChatId });

export const readHistory = (chatId: PeerId, maxId?: number): Promise<unknown> =>
  rpc('readHistory', { chatId, ...(maxId !== undefined && { maxId }) });

export const fetchComments = (
  chatId: PeerId,
  messageId: number,
  options: { limit?: number; offsetId?: number; offsetDate?: number } = {},
): Promise<GetCommentsResult> => rpc('getComments', { chatId, messageId, ...options });

export const sendComment = (
  chatId: PeerId,
  messageId: number,
  text: string,
  replyTo?: number,
  randomId?: string,
): Promise<SendCommentResult> =>
  rpc('sendComment', {
    chatId,
    messageId,
    text,
    ...(replyTo !== undefined && { replyTo }),
    ...(randomId !== undefined && { randomId }),
  });

/**
Reads the slash-command menu Telegram offers for a chat: a bot's own commands
in a private chat, or the aggregate of the group's bots.
*/
export const fetchBotCommands = (chatId: PeerId): Promise<GetBotCommandsResult> => rpc('getBotCommands', { chatId });

export const searchMessages = (chatId: PeerId, query: string): Promise<SearchMessagesResult> =>
  rpc('searchMessages', { chatId, query, limit: 50 });

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
