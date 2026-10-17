import { describe, expect, it } from 'vitest';
import { SessionEngine } from '@telegram-web-client/worker';

describe('SessionEngine (scaffold stub)', () => {
  it('answers on fetch with the not-ready payload', async () => {
    const engine = new SessionEngine({} as DurableObjectState, {} as CloudflareEnv);
    const response = await engine.fetch(new Request('https://session-engine.internal/'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ready: false, service: 'telegram-web-client' });
  });
});
