import { describe, expect, it } from 'vitest';
import {
  describeLoginFailure,
  failureText,
  rpcErrorText,
  rpcErrorToEngineError,
} from '../../packages/backend-services/src/session/rpc-errors';
import { EngineError, STORAGE_WRITE_QUOTA_MESSAGE } from '../../packages/backend-services/src/session/errors';

/**
 * The bridge's failure vocabulary: mtcute's server strings become the
 * reader's words, and everything else keeps the message that produced it.
 */

function rpcError(text: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(text), { text, ...extra });
}

describe('rpcErrorText', () => {
  it('reads only a string carried on an Error', () => {
    expect(rpcErrorText(rpcError('FLOOD_WAIT_%d'))).toBe('FLOOD_WAIT_%d');
    expect(rpcErrorText(new Error('plain'))).toBeNull();
    expect(rpcErrorText({ text: 'not an error' })).toBeNull();
    expect(rpcErrorText('text')).toBeNull();
  });
});

describe('failureText', () => {
  it('prefers an engine error, then the quota message, then the original', () => {
    expect(failureText(new EngineError('bad params', 400))).toBe('bad params');
    expect(failureText(new Error('Exceeded allowed rows written in Durable Objects free tier'))).toBe(STORAGE_WRITE_QUOTA_MESSAGE);
    expect(failureText(new Error('network down'))).toBe('network down');
    expect(failureText('a string')).toBe('a string');
  });
});

describe('rpcErrorToEngineError', () => {
  it('maps a peer Telegram refuses to a missing chat', () => {
    for (const text of ['CHANNEL_INVALID', 'PEER_ID_INVALID', 'USER_ID_INVALID', 'CHANNEL_PRIVATE', 'CHAT_ID_INVALID']) {
      const failure = rpcErrorToEngineError(rpcError(text));
      expect(failure?.status).toBe(404);
      expect(failure?.type).toBe('not_found');
    }
  });

  it('maps a message that left the chat to not found', () => {
    expect(rpcErrorToEngineError(rpcError('MESSAGE_ID_INVALID'))?.type).toBe('not_found');
    expect(rpcErrorToEngineError(rpcError('MSG_ID_INVALID'))?.type).toBe('not_found');
  });

  it('maps the write refusals to access', () => {
    for (const text of ['CHAT_WRITE_FORBIDDEN', 'CHAT_ADMIN_REQUIRED', 'CHAT_RESTRICTED', 'CHAT_SEND_MEDIA_FORBIDDEN', 'USER_IS_BLOCKED']) {
      const failure = rpcErrorToEngineError(rpcError(text));
      expect(failure?.status).toBe(403);
      expect(failure?.type).toBe('access');
    }
  });

  it('maps a message that cannot take another reaction to a conflict', () => {
    const failure = rpcErrorToEngineError(rpcError('REACTIONS_TOO_MANY'));
    expect(failure?.status).toBe(409);
    expect(failure?.type).toBe('conflict');
    expect(failure?.message).toContain('reactions');
  });

  it('maps a flood wait to a rate limit with its seconds', () => {
    const failure = rpcErrorToEngineError(rpcError('FLOOD_WAIT_%d', { seconds: 42 }));
    expect(failure?.status).toBe(429);
    expect(failure?.type).toBe('rate_limited');
    expect(failure?.message).toContain('42 seconds');
  });

  it('keeps an unmapped Telegram refusal as its own text', () => {
    const failure = rpcErrorToEngineError(rpcError('QUERY_TOO_SHORT'));
    expect(failure?.status).toBe(400);
    expect(failure?.type).toBe('validation');
    expect(failure?.message).toBe('QUERY_TOO_SHORT');
  });

  it('leaves a non-RPC failure to the boundary', () => {
    expect(rpcErrorToEngineError(new Error('boom'))).toBeNull();
    expect(rpcErrorToEngineError('PEER_ID_INVALID')).toBeNull();
    expect(rpcErrorToEngineError(null)).toBeNull();
  });
});

describe('describeLoginFailure', () => {
  it('names every login failure Telegram documents', () => {
    expect(describeLoginFailure(rpcError('PHONE_NUMBER_INVALID'))).toContain('international format');
    expect(describeLoginFailure(rpcError('PHONE_NUMBER_BANNED'))).toContain('banned');
    expect(describeLoginFailure(rpcError('PHONE_NUMBER_UNOCCUPIED'))).toContain('no Telegram account');
    expect(describeLoginFailure(rpcError('PHONE_CODE_INVALID'))).toContain('code was not right');
    expect(describeLoginFailure(rpcError('PHONE_CODE_EXPIRED'))).toContain('expired');
    expect(describeLoginFailure(rpcError('SESSION_PASSWORD_NEEDED'))).toContain('cloud password');
  });

  it('reports the wait from a flood error, with or without a number', () => {
    expect(describeLoginFailure(rpcError('FLOOD_WAIT_%d', { seconds: 17 }))).toContain('17 seconds');
    expect(describeLoginFailure(rpcError('FLOOD_WAIT_%d'))).toContain('a few seconds');
  });

  it('keeps an unrecognised failure as it was', () => {
    expect(describeLoginFailure(rpcError('SOMETHING_ELSE'))).toBe('SOMETHING_ELSE');
    expect(describeLoginFailure('plain failure')).toBe('plain failure');
  });
});
