/**
 * mtcute's RPC failures, without importing mtcute's error classes.
 *
 * `RpcError` is not reachable from `@mtcute/core`'s public export map (it is
 * only re-exported through the package's internal `tl/index.js`), so failures
 * are recognised by shape: the class extends `Error` and carries the server's
 * error string on `text` (`PHONE_CODE_INVALID`, `SESSION_PASSWORD_NEEDED`, …).
 * `FLOOD_WAIT_n` is normalised to `FLOOD_WAIT_%d` with the seconds beside it.
 */

import { EngineError, isStorageWriteQuotaError, STORAGE_WRITE_QUOTA_MESSAGE } from './errors';

export function rpcErrorText(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const text = (error as { text?: unknown }).text;
  return typeof text === 'string' ? text : null;
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
      const seconds = (error as { seconds?: unknown }).seconds;
      const wait = typeof seconds === 'number' ? `${String(seconds)} seconds` : 'a few seconds';
      return `Telegram rate-limited this attempt; wait ${wait} and try again.`;
    }
    default: {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
