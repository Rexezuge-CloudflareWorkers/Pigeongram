import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { JWK } from 'jose';
import { resetRateLimitForTests } from '@rexezuge/http';
import worker from '@pigeongram/api';

const context = {} as ExecutionContext;

const audience = 'access-application-aud';

let teamDomain: string;
let certsUrl: string;
let signingKey: CryptoKey;
let publicJwk: JWK;
let jwksFetches = 0;
let teamCounter = 0;

/**
A token shaped like the one Cloudflare Access forwards to the origin.
*/
async function accessToken(
  options: { issuer?: string; audience?: string; expiresAt?: number; emailVerified?: boolean } = {},
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: 'owner@example.com',
    ...(options.emailVerified !== undefined && { email_verified: options.emailVerified }),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options.issuer ?? teamDomain)
    .setAudience(options.audience ?? audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(options.expiresAt ?? issuedAt + 300)
    .sign(signingKey);
}

function configured(): Partial<CloudflareEnv> {
  return { TEAM_DOMAIN: teamDomain, POLICY_AUD: audience };
}

async function call(path: string, env: Partial<CloudflareEnv> = {}, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://example.com${path}`, init), env as CloudflareEnv, context);
}

/**
Calls the Access entry point with a valid assertion and returns its redirect
target.
*/
async function loginRedirect(next: string | null): Promise<string | null> {
  const token = await accessToken();
  const query = next === null ? '' : `?next=${encodeURIComponent(next)}`;
  const response = await call(`/user/login${query}`, configured(), {
    headers: { 'cf-access-jwt-assertion': token },
  });
  expect(response.status).toBe(302);
  return response.headers.get('location');
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
});

beforeEach(() => {
  // The SDK caches JWKS resolvers per team domain for the isolate's lifetime;
  // a fresh domain per test keeps one test's keys out of the next one's cache.
  teamCounter += 1;
  teamDomain = `https://team-${teamCounter}.example.com`;
  certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  jwksFetches = 0;
  resetRateLimitForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== certsUrl) throw new Error(`Unexpected fetch: ${url}`);
      jwksFetches += 1;
      return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'max-age=60' } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker entry', () => {
  it('serves /api/health without Access', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'telegram-web-client' });
  });

  it('does not keep the old /health alias', async () => {
    const response = await call('/health');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'not_found' } });
  });

  it('does not expose account routes on the public /api plane', async () => {
    const response = await call('/api/state', configured());
    expect(response.status).toBe(404);
  });

  it('answers every response with the canonical error envelope', async () => {
    const response = await call('/api/state', configured());
    await expect(response.json()).resolves.toEqual({
      Exception: { Type: 'not_found', Message: 'Not found' },
    });
  });

  it('sets the baseline security headers', async () => {
    const response = await call('/api/health');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('keeps account responses out of shared caches', async () => {
    const response = await call('/user/state', configured());
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('mints and echoes the correlation id', async () => {
    const generated = await call('/api/health');
    expect(generated.headers.get('x-correlation-id')).toBeTruthy();

    const inbound = await call('/api/health', {}, { headers: { 'x-correlation-id': 'correlation-123' } });
    expect(inbound.headers.get('x-correlation-id')).toBe('correlation-123');
  });

  it('401s /user/* without an Access assertion when configured', async () => {
    const response = await call('/user/state', configured());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'access', Message: expect.any(String) as string } });
  });

  it('gates the Access entry point like the rest of /user/*', async () => {
    const response = await call('/user/login', configured());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'access' } });
  });

  it('sends the Access entry point back into the SPA', async () => {
    await expect(loginRedirect(null)).resolves.toBe('/');
  });

  it('preserves a same-origin path through the Access login', async () => {
    await expect(loginRedirect('/chat/2')).resolves.toBe('/chat/2');
  });

  it('never redirects off-origin or back into the entry point', async () => {
    const rejected = ['https://evil.example', '//evil.example', String.raw`/\evil.example`, '/\r\nX-Test: 1', '/user/login'];
    for (const next of rejected) {
      await expect(loginRedirect(next)).resolves.toBe('/');
    }
  });

  it('503s /user/* when Access is not configured', async () => {
    const response = await call('/user/state');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      Exception: { Type: 'access_config', Message: expect.any(String) as string },
    });
  });

  it('lets a valid Access assertion through to the engine', async () => {
    const token = await accessToken();
    const response = await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': token } });
    // The test env has no SESSION_ENGINE binding; reaching this 503 means the
    // request passed the Access gate.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      Exception: { Type: 'unavailable', Message: expect.stringContaining('Session Engine Unreachable') as string },
    });
  });

  it('rejects an expired Access assertion', async () => {
    const token = await accessToken({ expiresAt: Math.floor(Date.now() / 1000) - 10 });
    const response = await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': token } });
    expect(response.status).toBe(401);
  });

  it('rejects an assertion for an unverified address', async () => {
    const token = await accessToken({ emailVerified: false });
    const response = await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': token } });
    expect(response.status).toBe(401);
  });

  it('rejects an assertion issued for another Access application', async () => {
    const token = await accessToken({ audience: 'some-other-aud' });
    const response = await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': token } });
    expect(response.status).toBe(401);
  });

  it('rejects an assertion from another team domain', async () => {
    const token = await accessToken({ issuer: 'https://other-team.cloudflareaccess.com' });
    const response = await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': token } });
    expect(response.status).toBe(401);
  });

  it('rejects an assertion signed by an unknown key', async () => {
    const other = await generateKeyPair('RS256');
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(teamDomain)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(other.privateKey);
    const response = await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': token } });
    expect(response.status).toBe(401);
  });

  it('caches the team JWKS across requests', async () => {
    const first = await accessToken();
    const second = await accessToken();
    await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': first } });
    await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': second } });
    expect(jwksFetches).toBe(1);
  });

  it('rejects a cross-origin state-changing request', async () => {
    const token = await accessToken();
    const response = await call('/user/state', configured(), {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'access', Message: 'Origin not allowed' } });
  });

  it('lets a same-origin state-changing request through', async () => {
    const token = await accessToken();
    const response = await call('/user/state', configured(), {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://example.com' },
    });
    expect(response.status).toBe(503);
  });

  it('throttles the account plane beyond the configured budget', async () => {
    const token = await accessToken();
    const env = { ...configured(), RATE_LIMIT_PER_MINUTE: '1' };
    const init = {
      headers: { 'cf-access-jwt-assertion': token, 'cf-connecting-ip': '203.0.113.9' },
    } satisfies RequestInit;

    const first = await call('/user/state', env, init);
    expect(first.status).toBe(503);

    const second = await call('/user/state', env, init);
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
    await expect(second.json()).resolves.toMatchObject({ Exception: { Type: 'RateLimited' } });
  });

  it('does not throttle media on the account plane budget', async () => {
    const token = await accessToken();
    const env = { ...configured(), RATE_LIMIT_PER_MINUTE: '1' };
    const init = {
      headers: { 'cf-access-jwt-assertion': token, 'cf-connecting-ip': '203.0.113.10' },
    } satisfies RequestInit;

    expect((await call('/user/state', env, init)).status).toBe(503);
    expect((await call('/user/state', env, init)).status).toBe(429);

    // The media routes draw on their own bucket: a spent account budget must
    // not turn an avatar or a thumbnail into a 429.
    for (const path of ['/user/file?chatId=1&messageId=1&thumb=1', '/user/avatar?chatId=1&size=small&v=1']) {
      expect((await call(path, env, init)).status).toBe(503);
    }
  });

  it('does not spend the account budget on media requests', async () => {
    const token = await accessToken();
    const env = { ...configured(), RATE_LIMIT_PER_MINUTE: '1' };
    const init = {
      headers: { 'cf-access-jwt-assertion': token, 'cf-connecting-ip': '203.0.113.11' },
    } satisfies RequestInit;

    for (const path of [
      '/user/file?chatId=1&messageId=1',
      '/user/avatar?chatId=1&size=small&v=1',
      '/user/file?chatId=1&messageId=2&thumb=1',
    ]) {
      expect((await call(path, env, init)).status).toBe(503);
    }

    expect((await call('/user/state', env, init)).status).toBe(503);
    expect((await call('/user/state', env, init)).status).toBe(429);
  });

  it('throttles the media plane beyond the configured media budget', async () => {
    const token = await accessToken();
    const env = { ...configured(), MEDIA_RATE_LIMIT_PER_MINUTE: '1' };
    const init = {
      headers: { 'cf-access-jwt-assertion': token, 'cf-connecting-ip': '203.0.113.12' },
    } satisfies RequestInit;

    expect((await call('/user/avatar?chatId=1&size=small&v=1', env, init)).status).toBe(503);

    const throttled = await call('/user/file?chatId=1&messageId=1&thumb=1', env, init);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('retry-after')).toBeTruthy();
    await expect(throttled.json()).resolves.toMatchObject({ Exception: { Type: 'RateLimited' } });
  });

  it('honors the local-development bypass outside production', async () => {
    const response = await call('/user/state', { ACCESS_DEV_BYPASS: 'true', ACCESS_DEV_EMAIL: 'dev@example.com' });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      Exception: { Type: 'unavailable', Message: expect.stringContaining('Session Engine Unreachable') as string },
    });
  });

  it('fails closed when the bypass has no dev identity', async () => {
    const response = await call('/user/state', { ACCESS_DEV_BYPASS: 'true' });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'access' } });
  });

  it('refuses the development bypass in production', async () => {
    const response = await call('/user/state', {
      ACCESS_DEV_BYPASS: 'true',
      ACCESS_DEV_EMAIL: 'dev@example.com',
      ENVIRONMENT: 'production',
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'access_config' } });
  });

  it('does not accept the retired query token on the socket route', async () => {
    const response = await call('/user/updates?token=secret', configured());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'access' } });
  });
});

/**
A stand-in for the Durable Object namespace. `fetchImpl` answers the forwarded
request, so the test can inspect exactly what the worker sent.
*/
function engineBinding(fetchImpl: (request: Request) => Promise<Response>): DurableObjectNamespace {
  return {
    idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
    get: () => ({ fetch: fetchImpl }) as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}

function manifest(items: readonly Record<string, unknown>[]): string {
  return Buffer.from(JSON.stringify(items), 'utf8').toString('base64url');
}

describe('upload pre-flight', () => {
  it.each([
    ['without the required query parameters', '/user/upload', '3', 400],
    ['whose content-length disagrees with the declared size', '/user/upload?chatId=2&kind=document&size=3', '4', 400],
    ['above the configured cap before forwarding it', '/user/upload?chatId=2&kind=document&size=104857601', '104857601', 413],
  ])('rejects an upload %s', async (_name, path, contentLength, status) => {
    const token = await accessToken();
    const response = await call(path, configured(), {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://example.com', 'content-length': contentLength },
      body: 'abc',
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'validation' } });
  });

  it('forwards a valid single upload to the engine', async () => {
    const token = await accessToken();
    const seen: Request[] = [];
    const env = {
      ...configured(),
      SESSION_ENGINE: engineBinding(async (request) => {
        seen.push(request);
        return Response.json({ uploaded: true });
      }),
    };

    const response = await call('/user/upload?chatId=2&kind=document&size=3', env, {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://example.com', 'content-length': '3' },
      body: 'abc',
    });

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('POST');
  });

  it('rejects an album without a manifest', async () => {
    const token = await accessToken();
    const response = await call('/user/upload-group?chatId=2', configured(), {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://example.com', 'content-length': '2' },
      body: 'ab',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ Exception: { Type: 'validation' } });
  });

  it('forwards a valid album upload to the engine', async () => {
    const token = await accessToken();
    const seen: Request[] = [];
    const env = {
      ...configured(),
      SESSION_ENGINE: engineBinding(async (request) => {
        seen.push(request);
        return Response.json({ uploaded: true });
      }),
    };
    const encoded = manifest([
      { kind: 'document', size: 1 },
      { kind: 'document', size: 1 },
    ]);

    const response = await call(`/user/upload-group?chatId=2&manifest=${encoded}`, env, {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://example.com', 'content-length': '2' },
      body: 'ab',
    });

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
  });
});

describe('engine forwarding', () => {
  it('stamps the correlation id on the request and the response', async () => {
    const token = await accessToken();
    const seen: Request[] = [];
    const env = {
      ...configured(),
      SESSION_ENGINE: engineBinding(async (request) => {
        seen.push(request);
        return Response.json({ ok: true });
      }),
    };

    const response = await call('/user/state', env, {
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://example.com', 'x-correlation-id': 'correlation-123' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(seen[0]?.headers.get('x-correlation-id')).toBe('correlation-123');
    expect(response.headers.get('x-correlation-id')).toBe('correlation-123');
  });

  it('forwards a socket upgrade with its headers intact', async () => {
    const token = await accessToken();
    let upgrade: string | null = null;
    const env = {
      ...configured(),
      SESSION_ENGINE: engineBinding(async (request) => {
        upgrade = request.headers.get('upgrade');
        return new Response(null, { status: 200 });
      }),
    };

    const response = await call('/user/updates', env, {
      headers: {
        'cf-access-jwt-assertion': token,
        origin: 'https://example.com',
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13',
      },
    });

    expect(response.status).toBe(200);
    expect(upgrade).toBe('websocket');
  });

  it('answers 503 when the engine itself fails', async () => {
    const token = await accessToken();
    const env = {
      ...configured(),
      SESSION_ENGINE: engineBinding(async () => {
        throw new Error('engine down');
      }),
    };

    const response = await call('/user/state', env, { headers: { 'cf-access-jwt-assertion': token } });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      Exception: { Type: 'unavailable', Message: expect.stringContaining('Session Engine Unreachable') as string },
    });
  });
});
