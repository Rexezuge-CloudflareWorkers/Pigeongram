import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Cloudflare Access verification for the bridge.
 *
 * Access authenticates the browser at the Pages edge and forwards a signed
 * application token as `Cf-Access-Jwt-Assertion`; the Pages Function passes the
 * request through untouched. The worker is the last gate before the
 * `SessionEngine` Durable Object, so it verifies that token itself: a
 * misconfigured Pages route, a direct service-binding call, or a forged header
 * must not reach the account's MTProto session.
 *
 * Only the signature, issuer, audience and expiry are checked. The Access
 * application's policy is the allowlist — this deployment is single-user, so
 * the worker does not inspect `email` (and never trusts the spoofable
 * `Cf-Access-Authenticated-User-Email` header).
 */

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

/**
 * One fetcher per team domain, cached for the isolate's lifetime.
 * `createRemoteJWKSet` caches the keys and refetches only when a token names an
 * unknown `kid`, so a fresh instance per request would add the team domain's
 * latency to every call for no benefit.
 */
const jwksCache = new Map<string, RemoteJwks>();

let warnedAboutBypass = false;

function remoteJwksFor(teamDomain: string): RemoteJwks {
  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  let jwks = jwksCache.get(certsUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(certsUrl));
    jwksCache.set(certsUrl, jwks);
  }
  return jwks;
}

interface AccessConfig {
  teamDomain: string;
  audience: string;
}

/**
 * The deployment's Access application, or `null` when it is not configured.
 *
 * `TEAM_DOMAIN` is normalized to its https origin so a trailing slash cannot
 * make the issuer comparison fail; a path, query or non-https scheme is a
 * configuration error rather than something to silently drop.
 */
function accessConfig(env: CloudflareEnv): AccessConfig | null {
  const rawTeamDomain = (env.TEAM_DOMAIN ?? '').trim();
  const audience = (env.POLICY_AUD ?? '').trim();
  if (!rawTeamDomain || !audience || audience.includes(',')) return null;

  let url: URL;
  try {
    url = new URL(rawTeamDomain);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null;

  return { teamDomain: url.origin, audience };
}

function rejection(error: string, code: 'access' | 'access_config', status: 401 | 503): Response {
  return Response.json({ error, code }, { status });
}

/**
 * Verifies the request's Cloudflare Access token.
 *
 * Returns `null` when the request may continue, or the response that rejects it.
 * Missing or invalid credentials answer `401`; a deployment that has not
 * configured the verifier answers `503` rather than running unauthenticated.
 */
export async function requireAccess(request: Request, env: CloudflareEnv): Promise<Response | null> {
  if (env.ACCESS_DEV_BYPASS === 'true') {
    if (env.ENVIRONMENT === 'production') {
      console.error('[access] ACCESS_DEV_BYPASS is set in production; refusing to skip JWT verification');
      return rejection('ACCESS_DEV_BYPASS must not be enabled in production', 'access_config', 503);
    }
    if (!warnedAboutBypass) {
      warnedAboutBypass = true;
      console.warn('[access] ACCESS_DEV_BYPASS is enabled; Cloudflare Access JWT verification is skipped');
    }
    return null;
  }

  const config = accessConfig(env);
  if (!config) {
    console.error('[access] TEAM_DOMAIN and POLICY_AUD must name the Cloudflare Access application');
    return rejection('Cloudflare Access verification is not configured', 'access_config', 503);
  }

  const token = (request.headers.get('cf-access-jwt-assertion') ?? '').trim();
  if (!token) {
    return rejection('Cloudflare Access token required', 'access', 401);
  }

  try {
    await jwtVerify(token, remoteJwksFor(config.teamDomain), {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ['RS256'],
    });
    return null;
  } catch (error) {
    // The jose message can name the expected issuer/audience or describe the
    // cert fetch; log it for the operator, but keep the client answer generic.
    console.warn('[access] Cloudflare Access JWT rejected:', error instanceof Error ? error.message : String(error));
    return rejection('Cloudflare Access token is invalid', 'access', 401);
  }
}

/**
 * Test-only: drop the memoized JWKS fetchers so a test that re-points at a
 * different certs endpoint does not inherit another test's cache.
 */
export function resetAccessJwksCacheForTests(): void {
  jwksCache.clear();
}
