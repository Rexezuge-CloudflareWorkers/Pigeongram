import { describe, expect, it } from 'vitest';
import { allowedOrigins, isOriginAllowed, originRejection, requestOrigin } from '../../packages/backend-services/src/session/origin';

/**
 * The bridge's CSRF boundary.
 *
 * The allowlist is the request's own URL, the https form of `Host`, and the
 * deployment's configured origins. Nothing else may pass: a client controls
 * `Origin`, `Referer`, `Host` and `Sec-Fetch-Site`, so a rule that trusts any
 * of them on its own is a bypass rather than a defense.
 */

function request(url: string, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(url, { method, headers });
}

describe('requestOrigin', () => {
  it('prefers Origin over Referer', () => {
    expect(
      requestOrigin(request('https://app.example/user/rpc', { origin: 'https://app.example', referer: 'https://other.example/x' })),
    ).toBe('https://app.example');
  });

  it('falls back to Referer when Origin is absent or malformed', () => {
    expect(requestOrigin(request('https://app.example/user/rpc', { referer: 'https://app.example/chat/1' }))).toBe('https://app.example');
    expect(requestOrigin(request('https://app.example/user/rpc', { origin: 'not a url', referer: 'https://app.example/x' }))).toBe(
      'https://app.example',
    );
  });

  it('returns null for missing or malformed values', () => {
    expect(requestOrigin(request('https://app.example/user/rpc'))).toBeNull();
    expect(requestOrigin(request('https://app.example/user/rpc', { origin: ' '.repeat(3) }))).toBeNull();
    expect(requestOrigin(request('https://app.example/user/rpc', { origin: 'not a url' }))).toBeNull();
    expect(requestOrigin(request('https://app.example/user/rpc', { referer: 'not a url' }))).toBeNull();
  });

  it('normalizes to the origin, dropping path, query and fragment', () => {
    expect(requestOrigin(request('https://app.example/user/rpc', { origin: 'https://app.example/chat/1?x=1#top' }))).toBe(
      'https://app.example',
    );
  });
});

describe('allowedOrigins', () => {
  it('trusts the request URL origin', () => {
    expect(allowedOrigins(request('https://app.example/user/rpc'))).toContain('https://app.example');
  });

  it('trusts the https form of Host but never the http form', () => {
    const allowed = allowedOrigins(request('https://worker.internal/user/rpc', { host: 'app.example' }));
    expect(allowed).toContain('https://app.example');
    expect(allowed).not.toContain('http://app.example');
  });

  it('normalizes and trims configured origins', () => {
    const allowed = allowedOrigins(request('https://worker.internal/user/rpc'), {
      PAGES_ORIGIN: ' https://app.example/ ',
      ALLOWED_ORIGINS: 'https://preview.example, ,not a url,https://second.example/path',
    });
    expect(allowed).toContain('https://app.example');
    expect(allowed).toContain('https://preview.example');
    expect(allowed).toContain('https://second.example');
    expect(allowed).not.toContain('not a url');
  });

  it('ignores a blank Host', () => {
    const allowed = allowedOrigins(request('https://app.example/user/rpc', { host: '  ' }));
    expect([...allowed]).toEqual(['https://app.example']);
  });
});

describe('isOriginAllowed', () => {
  it('accepts the request URL origin', () => {
    expect(isOriginAllowed(request('https://app.example/user/rpc', { origin: 'https://app.example' }))).toBe(true);
  });

  it('accepts a configured deployment origin', () => {
    const env = { PAGES_ORIGIN: 'https://pages.example' };
    expect(isOriginAllowed(request('https://worker.internal/user/rpc', { origin: 'https://pages.example' }), env)).toBe(true);
  });

  it('accepts a configured origin list and the Referer fallback', () => {
    const env = { ALLOWED_ORIGINS: 'https://preview.example' };
    expect(isOriginAllowed(request('https://worker.internal/user/rpc', { referer: 'https://preview.example/chat/1' }), env)).toBe(true);
  });

  it('rejects a cross-origin request', () => {
    expect(isOriginAllowed(request('https://app.example/user/rpc', { origin: 'https://evil.example' }))).toBe(false);
  });

  it('rejects a request with neither Origin nor Referer', () => {
    expect(isOriginAllowed(request('https://app.example/user/rpc'))).toBe(false);
  });

  it('does not let Sec-Fetch-Site bypass the allowlist', () => {
    const forged = request('https://app.example/user/rpc', {
      origin: 'https://evil.example',
      'sec-fetch-site': 'same-origin',
    });
    expect(isOriginAllowed(forged)).toBe(false);
  });

  it('does not consult Sec-Fetch-Site at all', () => {
    const sameOrigin = request('https://app.example/user/rpc', {
      origin: 'https://app.example',
      'sec-fetch-site': 'cross-site',
    });
    expect(isOriginAllowed(sameOrigin)).toBe(true);
  });

  it('does not accept an http Origin matched by a spoofed Host', () => {
    const spoofed = request('https://worker.internal/user/rpc', {
      origin: 'http://evil.example',
      host: 'evil.example',
    });
    expect(isOriginAllowed(spoofed)).toBe(false);
  });

  it('compares the whole origin, including the port', () => {
    expect(isOriginAllowed(request('http://localhost:8787/user/rpc', { origin: 'http://localhost:5173' }))).toBe(false);
    expect(
      isOriginAllowed(request('http://localhost:8787/user/rpc', { origin: 'http://localhost:5173' }), {
        PAGES_ORIGIN: 'http://localhost:5173',
      }),
    ).toBe(true);
  });
});

describe('originRejection', () => {
  it('answers in the canonical envelope with a 403', async () => {
    const response = originRejection();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ Exception: { Type: 'access', Message: 'Origin not allowed' } });
  });
});
