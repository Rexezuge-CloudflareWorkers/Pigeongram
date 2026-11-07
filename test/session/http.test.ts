import { ServiceError } from '@rexezuge/errors';
import { describe, expect, it } from 'vitest';
import { EngineConfigError } from '../../packages/provider-clients/src/mtproto/client';
import { EngineError, STORAGE_WRITE_QUOTA_MESSAGE } from '../../packages/backend-services/src/session/errors';
import { errorResponse, MAX_JSON_BODY_BYTES, readJsonBody } from '../../packages/backend-services/src/session/http';

/**
 * The bridge's request boundary: a body larger than the CPU budget is worth
 * is refused before it is parsed, and every failure keeps its JSON shape.
 */

const URL = 'https://session-engine.internal/user/rpc';

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
}

describe('readJsonBody', () => {
  it('reads a JSON object', async () => {
    await expect(readJsonBody(jsonRequest('{"method":"getMe"}'))).resolves.toEqual({ method: 'getMe' });
  });

  it('refuses a body with no content', async () => {
    const response = await readJsonBody(new Request(URL, { method: 'POST' })).catch((error: unknown) => error);
    expect(response).toBeInstanceOf(EngineError);
    expect((response as EngineError).status).toBe(400);
  });

  it('refuses malformed JSON', async () => {
    const failure = await readJsonBody(jsonRequest('{')).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EngineError);
    expect((failure as EngineError).status).toBe(400);
  });

  it('refuses a body that is not an object', async () => {
    for (const body of ['[]', 'null', '"text"', '42']) {
      const failure = await readJsonBody(jsonRequest(body)).catch((error: unknown) => error);
      expect(failure, body).toBeInstanceOf(EngineError);
      expect((failure as EngineError).status, body).toBe(400);
    }
  });

  it('refuses a declared body larger than the cap without reading it', async () => {
    const failure = await readJsonBody(jsonRequest('{}', { 'content-length': String(MAX_JSON_BODY_BYTES + 1) })).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(EngineError);
    expect((failure as EngineError).status).toBe(413);
  });

  it('stops a chunked body that crosses the cap', async () => {
    const chunk = new Uint8Array(64 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 5; index += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request(URL, { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    const failure = await readJsonBody(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EngineError);
    expect((failure as EngineError).status).toBe(413);
  });

  it('accepts a body just under the cap', async () => {
    const padding = 'x'.repeat(MAX_JSON_BODY_BYTES - 64);
    const body = JSON.stringify({ method: 'getMe', padding });
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAX_JSON_BODY_BYTES);
    await expect(readJsonBody(jsonRequest(body))).resolves.toMatchObject({ method: 'getMe' });
  });
});

describe('errorResponse', () => {
  it('keeps an engine error status and derives its code', async () => {
    const response = errorResponse(new EngineError('bad input', 409));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ Exception: { Type: 'conflict', Message: 'bad input' } });
  });

  it('answers in the family taxonomy', () => {
    expect(new EngineError('bad input')).toBeInstanceOf(ServiceError);
    expect(new EngineConfigError('missing')).toBeInstanceOf(ServiceError);
  });

  it('classifies statuses a caller can act on', async () => {
    const cases: Array<[number, string]> = [
      [400, 'validation'],
      [404, 'not_found'],
      [403, 'access'],
      [502, 'upstream'],
      [503, 'unavailable'],
      [500, 'internal'],
    ];
    for (const [status, code] of cases) {
      const response = errorResponse(new EngineError('failure', status));
      await expect(response.json(), String(status)).resolves.toMatchObject({ Exception: { Type: code } });
    }
  });

  it('lets a call site name a more specific code', async () => {
    const response = errorResponse(new EngineError('over budget', 503, 'storage_write_quota'));

    await expect(response.json()).resolves.toEqual({
      Exception: { Type: 'storage_write_quota', Message: 'over budget' },
    });
  });

  it('maps a configuration failure to 503', async () => {
    const response = errorResponse(new EngineConfigError('TELEGRAM_API_ID is missing'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      Exception: { Type: 'config', Message: 'TELEGRAM_API_ID is missing' },
    });
  });

  it('gives the write quota its own code', async () => {
    const response = errorResponse(new Error('Exceeded allowed rows written in Durable Objects free tier'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      Exception: { Type: 'storage_write_quota', Message: STORAGE_WRITE_QUOTA_MESSAGE },
    });
  });

  it('turns anything else into a masked 500', async () => {
    const response = errorResponse(new Error('boom'));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      Exception: { Type: 'internal', Message: 'Internal server error' },
    });
  });

  it('keeps the correlation id out of the body', async () => {
    const response = errorResponse(new EngineError('bad input', 400), 'correlation-1');
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty('correlationId');
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('error');
  });
});
