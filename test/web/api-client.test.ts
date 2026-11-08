import { ServiceError } from '@rexezuge/errors';
import { HttpStatusError } from '@rexezuge/web/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getState, isAuthError } from '../../apps/web/src/api';
import { batchResult, request, rpc, rpcBatch } from '../../apps/web/src/api/request';
import type { RpcBatchOutcome } from '../../apps/web/src/types';

/**
 * The bridge transport on the family's shared client: body serialisation,
 * error decoding, the Access probe's two "no answer" shapes, and the batch
 * helpers the chat and thread reads sit on.
 */

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'content-type': 'application/json' } });
}

function installFetch(handler: () => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('serialises an object body and parses the JSON answer', async () => {
    const fetchMock = installFetch(() => json({ ok: true }));

    await expect(request<{ ok: boolean }>('/user/rpc', { method: 'POST', body: { method: 'getMe' } })).resolves.toEqual({ ok: true });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/user/rpc');
    expect(init.body).toBe(JSON.stringify({ method: 'getMe' }));
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
  });

  it('decodes a canonical error body, including a type the catalog does not know', async () => {
    installFetch(() => json({ Exception: { Type: 'validation', Message: 'Bad input' } }, 422));

    await expect(request('/user/rpc')).rejects.toMatchObject({
      status: 422,
      type: 'validation',
      message: 'Bad input',
    });
  });

  it('reads the legacy error body during the transition', async () => {
    installFetch(() => json({ error: 'Too large', code: 'payload_too_large' }, 413));

    await expect(request('/user/upload')).rejects.toMatchObject({
      status: 413,
      message: 'Too large',
    });
  });
});

describe('rpc', () => {
  it('wraps a method and its params in the RPC envelope', async () => {
    const fetchMock = installFetch(() => json({ me: null }));

    await rpc('getDialogs', { limit: 100 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ method: 'getDialogs', params: { limit: 100 } }));
  });

  it('omits the params member when the method takes none', async () => {
    const fetchMock = installFetch(() => json({}));

    await rpc('getCallDhConfig');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ method: 'getCallDhConfig' }));
  });
});

describe('rpcBatch', () => {
  it('carries several calls in one request and returns their outcomes', async () => {
    const outcomes: RpcBatchOutcome[] = [{ ok: true, result: { me: null } }];
    const fetchMock = installFetch(() => json({ results: outcomes }));

    await expect(rpcBatch([{ method: 'getMe' }])).resolves.toEqual(outcomes);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ method: 'batch', params: { calls: [{ method: 'getMe' }] } }));
  });

  it('turns a missing or failed outcome into a 500 HttpStatusError', () => {
    expect(() => batchResult(undefined, 'chat list')).toThrow(HttpStatusError);
    expect(() => batchResult({ ok: false, error: 'Upstream said no' }, 'chat list')).toThrow('Upstream said no');
    try {
      batchResult(undefined, 'chat list');
    } catch (failure) {
      expect(failure).toMatchObject({ status: 500 });
    }
  });

  it('returns the result of a successful outcome', () => {
    expect(batchResult<{ value: number }>({ ok: true, result: { value: 1 } }, 'chat list')).toEqual({ value: 1 });
  });
});

describe('getState', () => {
  it('resolves to the engine snapshot', async () => {
    installFetch(() => json({ phase: 'authorized', authorized: true, me: null }));

    await expect(getState()).resolves.toMatchObject({ authorized: true });
  });

  it('turns a 200 HTML page (an Access login page) into a TypeError', async () => {
    installFetch(() => new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } }));

    await expect(getState()).rejects.toBeInstanceOf(TypeError);
  });

  it('turns a body that is not an engine snapshot into a TypeError', async () => {
    installFetch(() => json({ something: 'else' }));

    await expect(getState()).rejects.toBeInstanceOf(TypeError);
  });

  it('turns a transport failure into the TypeError the Access probe expects', async () => {
    installFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(getState()).rejects.toBeInstanceOf(TypeError);
  });

  it('leaves a bridge rejection as a ServiceError', async () => {
    installFetch(() => json({ Exception: { Type: 'access', Message: 'No assertion' } }, 401));

    await expect(getState()).rejects.toBeInstanceOf(ServiceError);
  });
});

describe('isAuthError', () => {
  it('recognises the two statuses the front door answers with', () => {
    expect(isAuthError(new HttpStatusError(401, 'No session', 'Unauthorized'))).toBe(true);
    expect(isAuthError(new HttpStatusError(403, 'No permission', 'Forbidden'))).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(isAuthError(new HttpStatusError(500, 'Boom', 'InternalError'))).toBe(false);
    expect(isAuthError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAuthError('not an error')).toBe(false);
  });
});
