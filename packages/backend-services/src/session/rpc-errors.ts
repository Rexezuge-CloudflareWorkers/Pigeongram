/**
 * mtcute's RPC failures, without importing mtcute's error classes.
 *
 * `RpcError` is not reachable from `@mtcute/core`'s public export map (it is
 * only re-exported through the package's internal `tl/index.js`), so failures
 * are recognised by shape: the class extends `Error` and carries the server's
 * error string on `text` (`PHONE_CODE_INVALID`, `SESSION_PASSWORD_NEEDED`, …).
 * `FLOOD_WAIT_n` is normalised to `FLOOD_WAIT_%d` with the seconds beside it.
 */

import { EngineError, isStorageWriteQuotaError, type EngineErrorCode, STORAGE_WRITE_QUOTA_MESSAGE } from './errors';

export function rpcErrorText(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const text = (error as { text?: unknown }).text;
  return typeof text === 'string' ? text : null;
}

/**
 * The Telegram refusals that mean the chat itself is gone for this account:
 * left, kicked out, deleted, or addressed with an access hash the session may
 * not use. The peer heal has already run by the time one of these reaches the
 * boundary, so the chat is not coming back within the request.
 */
const CHAT_UNREACHABLE = new Set(['CHANNEL_INVALID', 'PEER_ID_INVALID', 'USER_ID_INVALID', 'CHANNEL_PRIVATE', 'CHAT_ID_INVALID']);

/**
 * A message that no longer exists in the chat it was asked about (deleted,
 * expired, or never there).
 */
const MESSAGE_MISSING = new Set(['MESSAGE_ID_INVALID', 'MSG_ID_INVALID']);

/**
 * The family of refusals that mean "this account may not write that here":
 * the per-media `CHAT_SEND_*_FORBIDDEN` answers, a group's admin gate, a
 * channel's mute, and the blocklists.
 */
const WRITE_REFUSED_PATTERN =
  /^(?:CHAT_SEND_[A-Z_]*FORBIDDEN|CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|CHAT_RESTRICTED|USER_IS_BLOCKED|YOU_BLOCKED_USER)$/;

/**
 * The seconds a `FLOOD_WAIT_%d` names, when mtcute carried them.
 */
function floodWaitSeconds(error: unknown): number | null {
  const seconds = (error as { seconds?: unknown }).seconds;
  return typeof seconds === 'number' && seconds > 0 ? seconds : null;
}

/**
 * Turns a Telegram refusal into the bridge's own failure.
 *
 * A `RpcError` is the account's state, not an internal fault: the engine has
 * already retried what it can, so the caller needs a status it can act on and
 * a sentence it can show. Only `EngineError` values carry a bridge code, so
 * this is the one place that translates mtcute's vocabulary into it; a value
 * that is not an RPC failure returns `null` and stays masked by the boundary.
 *
 * The fallback keeps Telegram's own text: it describes the caller's account,
 * not the worker's internals, and it is the most useful thing to show.
 */
export function rpcErrorToEngineError(error: unknown): EngineError | null {
  const text = rpcErrorText(error);
  if (text === null) return null;
  const fail = (message: string, status: number, code: EngineErrorCode): EngineError => new EngineError(message, status, code);
  if (CHAT_UNREACHABLE.has(text)) return fail('That chat is not reachable from this account any more.', 404, 'not_found');
  if (MESSAGE_MISSING.has(text)) return fail('That message is not in this chat any more.', 404, 'not_found');
  if (WRITE_REFUSED_PATTERN.test(text)) return fail('This account may not do that in this chat.', 403, 'access');
  switch (text) {
    case 'REACTIONS_TOO_MANY': {
      return fail('That message already holds the most reactions Telegram allows.', 409, 'conflict');
    }
    case 'MESSAGE_NOT_MODIFIED': {
      return fail('That change is already applied.', 409, 'conflict');
    }
    case 'FLOOD_WAIT_%d': {
      const seconds = floodWaitSeconds(error);
      const wait = seconds === null ? 'a few seconds' : `${String(seconds)} seconds`;
      return fail(`Telegram rate-limited this request; wait ${wait} and try again.`, 429, 'rate_limited');
    }
    default: {
      return fail(text, 400, 'validation');
    }
  }
}

/**
 * The message a failed bridge call reports.
 *
 * The engine's own failures carry a status and a message; an exhausted write
 * budget has its own readable form; everything else falls back to the error's
 * own text.
 */
export function failureText(error: unknown): string {
  if (error instanceof EngineError) return error.message;
  if (isStorageWriteQuotaError(error)) return STORAGE_WRITE_QUOTA_MESSAGE;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The bridge code a failed call reports.
 *
 * A batch answers each call separately, and a caller that has to tell "the
 * chat is gone" from "the read failed" needs the code beside the sentence —
 * the HTTP status is not there to carry it, because the batch itself succeeded.
 */
export function failureCode(error: unknown): EngineErrorCode {
  if (error instanceof EngineError) return error.code;
  if (isStorageWriteQuotaError(error)) return 'storage_write_quota';
  return rpcErrorToEngineError(error)?.code ?? 'internal';
}

/**
 * Turns the RPC failures a login attempt can produce into something readable;
 * anything else keeps mtcute's own message.
 */
export function describeLoginFailure(error: unknown): string {
  switch (rpcErrorText(error)) {
    case 'PHONE_NUMBER_INVALID': {
      return (
        'Telegram rejected that phone number — check the international format (+15551234567). ' +
        'If the number is right, Telegram is applying anti-abuse to a freshly created API app: wait a few minutes and try again.'
      );
    }
    case 'PHONE_NUMBER_BANNED': {
      return 'That phone number is banned from Telegram.';
    }
    case 'PHONE_NUMBER_UNOCCUPIED': {
      return 'That number has no Telegram account — check it and try again.';
    }
    case 'PHONE_CODE_INVALID': {
      return 'That login code was not right — try again.';
    }
    case 'PHONE_CODE_EXPIRED': {
      return 'That login code expired — start over to request a new one.';
    }
    case 'SESSION_PASSWORD_NEEDED': {
      return 'Telegram wants your cloud password for two-step verification.';
    }
    case 'FLOOD_WAIT_%d': {
      const seconds = floodWaitSeconds(error);
      const wait = seconds === null ? 'a few seconds' : `${String(seconds)} seconds`;
      return `Telegram rate-limited this attempt; wait ${wait} and try again.`;
    }
    default: {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
