/**
 * The user API plane: a Pages Function that forwards `/user/*` to the worker
 * through the `API_WORKER` service binding (declared in
 * `pages/wrangler.template.jsonc`).
 *
 * Cloudflare Access guards this prefix at the edge and forwards its signed
 * `Cf-Access-Jwt-Assertion` header; the worker verifies it before the session
 * engine sees the request. The function adds nothing else.
 *
 * The request is passed through untouched, which is what makes the
 * `/user/updates` WebSocket upgrade work: the runtime forwards the upgrade and
 * the worker's 101 response straight back to the browser.
 *
 * This file must live at repo-root `functions/` — the materialized config is
 * read from the repo root, so Pages finds Functions next to it, not inside
 * `pages/`.
 */
interface Env {
  API_WORKER: Fetcher;
}

interface PagesContext {
  request: Request;
  env: Env;
}

export const onRequest = (context: PagesContext): Promise<Response> => context.env.API_WORKER.fetch(context.request);
