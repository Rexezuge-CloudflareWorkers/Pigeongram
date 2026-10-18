import { describe, expect, it } from 'vitest';
import worker from '@telegram-web-client/worker';

const context = {} as ExecutionContext;

async function call(path: string, env: Partial<CloudflareEnv> = {}, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://example.com${path}`, init), env as CloudflareEnv, context);
}

describe('worker entry', () => {
  it('serves /health', async () => {
    const response = await call('/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'telegram-web-client' });
  });

  it('401s gated /api/* requests without the token', async () => {
    const response = await call('/api/state', { SPIKE_TOKEN: 'secret' });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'gate', error: expect.any(String) as string });
  });

  it('lets a correctly-tokened request through to the engine and reports a missing binding', async () => {
    const response = await call('/api/state', { SPIKE_TOKEN: 'secret' }, { headers: { 'x-session-token': 'secret' } });
    expect(response.status).toBe(503);
  });

  it('accepts the token from the query string, for socket upgrades', async () => {
    const response = await call('/api/updates?token=secret', { SPIKE_TOKEN: 'secret' });
    expect(response.status).toBe(503);
  });

  it('leaves /api/* ungated when no token is configured', async () => {
    const response = await call('/api/state');
    expect(response.status).toBe(503);
  });
});
