/**
 * Hand-written amendments to the generated `CloudflareEnv`.
 *
 * `worker-configuration.d.ts` (produced by `wrangler types`) only names the
 * bindings and vars declared in `worker/wrangler.template.jsonc`; secrets are
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
}
