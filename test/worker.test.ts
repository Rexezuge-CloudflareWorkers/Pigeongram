import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { JWK } from 'jose';
import worker from '@pigeongram/api';
import { resetAccessJwksCacheForTests } from '../apps/api/src/access';

const context = {} as ExecutionContext;

const teamDomain = 'https://team.example.com';
const audience = 'access-application-aud';
const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;

let signingKey: CryptoKey;
let publicJwk: JWK;
let jwksFetches = 0;

/**
A token shaped like the one Cloudflare Access forwards to the origin.
*/
async function accessToken(options: { issuer?: string; audience?: string; expiresAt?: number } = {}): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: 'owner@example.com' })
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
  resetAccessJwksCacheForTests();
  jwksFetches = 0;
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
  });

  it('does not expose account routes on the public /api plane', async () => {
    const response = await call('/api/state', configured());
    expect(response.status).toBe(404);
  });

  it('401s /user/* without an Access assertion when configured', async () => {
    const response = await call('/user/state', configured());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'access', error: expect.any(String) as string });
  });

  it('gates the Access entry point like the rest of /user/*', async () => {
    const response = await call('/user/login', configured());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'access' });
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
    await expect(response.json()).resolves.toMatchObject({ code: 'access_config', error: expect.any(String) as string });
  });

  it('lets a valid Access assertion through to the engine', async () => {
    const token = await accessToken();
    const response = await call('/user/state', configured(), { headers: { 'cf-access-jwt-assertion': token } });
    // The test env has no SESSION_ENGINE binding; reaching this 503 means the
    // request passed the Access gate.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Session engine unreachable') as string });
  });

  it('rejects an expired Access assertion', async () => {
    const token = await accessToken({ expiresAt: Math.floor(Date.now() / 1000) - 10 });
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

  it('honors the local-development bypass outside production', async () => {
    const response = await call('/user/state', { ACCESS_DEV_BYPASS: 'true' });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Session engine unreachable') as string });
  });

  it('refuses the development bypass in production', async () => {
    const response = await call('/user/state', { ACCESS_DEV_BYPASS: 'true', ENVIRONMENT: 'production' });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'access_config' });
  });

  it('does not accept the retired query token on the socket route', async () => {
    const response = await call('/user/updates?token=secret', configured());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'access' });
  });
});
