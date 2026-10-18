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
   * Shared secret gating every `/api/*` route while Cloudflare Access is not
   * yet in front of the Pages project. Send it as `x-session-token` (or
   * `?token=` on the WebSocket URL). Delete the secret (or set it empty) once
   * Access — and the worker being non-public — is in place.
   */
  SPIKE_TOKEN?: string;
}
