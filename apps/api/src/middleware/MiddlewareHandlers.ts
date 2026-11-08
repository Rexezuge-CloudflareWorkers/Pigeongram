import { EngineError } from '@pigeongram/backend-services/session/errors';
import { errorResponse } from '@pigeongram/backend-services/session/http';
import { log } from '@pigeongram/backend-services/session/log';
import { isOriginAllowed, originRejection } from '@pigeongram/backend-services/session/origin';
import { AccessAuthError, authenticateAccess } from '@rexezuge/http';
import type { Next } from 'hono';
import type { ApiContext } from '../types';

interface AccessConfiguration {
  teamDomain: string;
  audience: string;
}

/**
 * The deployment's Access application, or `null` when it is unusable.
 *
 * `TEAM_DOMAIN` is normalized to its https origin so a trailing slash cannot
 * make the issuer comparison fail; a path, query or non-https scheme is a
 * configuration error rather than something to silently drop. A comma-joined
 * audience is refused here too: the verifier would fail it with a message that
 * reads like a bad signature and sends an operator looking at their keys.
 */
function readAccessConfiguration(env: Env): AccessConfiguration | null {
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

function isProduction(env: Env): boolean {
  return (env.ENVIRONMENT ?? '').toLowerCase() === 'production';
}

function isDevBypassEnabled(env: Env): boolean {
  return env.ACCESS_DEV_BYPASS === 'true' && !isProduction(env);
}

let warnedAboutBypass = false;

/**
 * The `/user/*` guards.
 *
 * The Access application in front of the Pages project is the allowlist; these
 * handlers are the worker's own last gate, because a misrouted Pages Function,
 * a direct service-binding call or a forged header must not reach the account's
 * MTProto session.
 */
export class MiddlewareHandlers {
  /**
   * Fail closed before any request is authenticated.
   *
   * A deployment with no usable `TEAM_DOMAIN`/`POLICY_AUD` answers
   * `503 access_config` rather than running unauthenticated, and a production
   * deployment that still carries `ACCESS_DEV_BYPASS` does the same: the var is
   * a local-development affordance, and honoring it in production would hand
   * every request the dev identity.
   */
  public static accessConfiguration(): (c: ApiContext, next: Next) => Promise<Response | void> {
    return async (c: ApiContext, next: Next): Promise<Response | void> => {
      if (c.env.ACCESS_DEV_BYPASS === 'true' && isProduction(c.env)) {
        log.error('access.bypass_in_production');
        return errorResponse(
          new EngineError('ACCESS_DEV_BYPASS must not be enabled in production', 503, 'access_config'),
          c.get('correlationId'),
        );
      }

      if (isDevBypassEnabled(c.env)) {
        if (!warnedAboutBypass) {
          warnedAboutBypass = true;
          log.warn('access.bypass_enabled');
        }
        return next();
      }

      if (readAccessConfiguration(c.env) === null) {
        log.error('access.config_missing');
        return errorResponse(
          new EngineError('Cloudflare Access verification is not configured', 503, 'access_config'),
          c.get('correlationId'),
        );
      }

      return next();
    };
  }

  /**
   * Verify the request's Cloudflare Access assertion.
   *
   * `authenticateAccess` checks the signature, issuer, audience and expiry
   * against the team's JWKS, refuses an assertion whose `email_verified` is
   * `false`, and collapses every failure to one message so an unauthenticated
   * caller cannot learn which part of a forged token they got right. The
   * identity is discarded: this deployment is single-user and the Access
   * application's policy is the allowlist.
   */
  public static authenticate(): (c: ApiContext, next: Next) => Promise<Response | void> {
    return async (c: ApiContext, next: Next): Promise<Response | void> => {
      const configuration = readAccessConfiguration(c.env);
      try {
        await authenticateAccess(c.req.raw, undefined, {
          bypassAllowed: isDevBypassEnabled(c.env),
          devAuthEmail: c.env.ACCESS_DEV_EMAIL,
          teamDomain: configuration?.teamDomain,
          policyAud: configuration?.audience,
        });
        return next();
      } catch (error) {
        if (!(error instanceof AccessAuthError)) throw error;
        log.warn('access.token_rejected', { error: error.message });
        return errorResponse(new EngineError('Cloudflare Access authentication failed.', 401, 'access'), c.get('correlationId'));
      }
    };
  }

  /**
   * Reject a cross-origin state-changing request.
   *
   * A browser request that carries the Access session is only acted on when its
   * `Origin` (or `Referer` fallback) names a trusted host. The socket upgrade
   * is included because a cross-origin page must not be able to open the
   * account's update stream either. The Durable Object repeats the check, so a
   * request that reaches it another way still fails.
   */
  public static origin(): (c: ApiContext, next: Next) => Promise<Response | void> {
    return async (c: ApiContext, next: Next): Promise<Response | void> => {
      const isWebSocketUpgrade = c.req.method === 'GET' && new URL(c.req.url).pathname === '/user/updates';
      if ((c.req.method === 'POST' || isWebSocketUpgrade) && !isOriginAllowed(c.req.raw, c.env)) {
        return originRejection();
      }
      return next();
    };
  }
}
