/**
 * Hand-written amendments to the generated `CloudflareEnv`.
 *
 * `worker-configuration.d.ts` (produced by `wrangler types`) only names the
 * bindings and vars declared in `apps/api/wrangler.template.jsonc`; secrets are
 * not part of the template and are therefore declared here. The declarations
 * merge into the generated interface because this file — like the generated
 * one — is a global script, not a module.
 */
interface CloudflareEnv {
  /**
  `api_id` from my.telegram.org, as a string. Required at runtime.
  */
  TELEGRAM_API_ID?: string;
  /**
  `api_hash` from my.telegram.org. Required at runtime.
  */
  TELEGRAM_API_HASH?: string;
  /**
   * Cloudflare Access team domain, for example
   * `https://your-team.cloudflareaccess.com`. Deployment-specific, so it is
   * supplied by `WRANGLER_VARS_PATCH_JSON` rather than the template. Required
   * in production: `/user/*` fails closed without it.
   */
  TEAM_DOMAIN?: string;
  /**
   * Application Audience (AUD) tag of the Access application in front of the
   * Pages project. Required in production alongside `TEAM_DOMAIN`.
   */
  POLICY_AUD?: string;
  /**
   * Local-development escape hatch: skips Cloudflare Access JWT verification.
   * Honored only when `ENVIRONMENT` is not `production`; enabling it in
   * production makes `/user/*` fail closed. Set it in `.dev.vars`, never in the
   * deployment's vars.
   */
  ACCESS_DEV_BYPASS?: string;
  /**
   * The identity the dev bypass authenticates as. Only read when
   * `ACCESS_DEV_BYPASS` is enabled outside production, so a deployment that
   * sets it by accident still fails closed.
   */
  ACCESS_DEV_EMAIL?: string;
  /**
   Comma-separated list of trusted browser origins for CSRF checks.
   */
  ALLOWED_ORIGINS?: string;
  /**
   The Pages origin serving the SPA, trusted for CSRF checks.
   */
  PAGES_ORIGIN?: string;
  /**
   Rate limit per minute per client for the account plane of `/user/*` (the
   RPC, login, state and upload routes). The media routes are metered by
   `MEDIA_RATE_LIMIT_PER_MINUTE` instead.
   */
  RATE_LIMIT_PER_MINUTE?: string;
  /**
   Rate limit per minute per client for the media plane of `/user/*`
   (`GET /user/file` and `GET /user/avatar`). Kept separate from
   `RATE_LIMIT_PER_MINUTE` because media requests are one-per-avatar and
   one-per-byte-range, so a single budget over both throttles normal browsing.
   */
  MEDIA_RATE_LIMIT_PER_MINUTE?: string;
}

/**
 * The generated file declares `Env` and `CloudflareEnv` as two interfaces over
 * the same base, so a hand-written amendment to `CloudflareEnv` would not be
 * visible through the `Env` name the kit's worker bases take. This merge makes
 * the two names one surface: the secrets above are members of both.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging, not a new empty shape
interface Env extends CloudflareEnv {}
