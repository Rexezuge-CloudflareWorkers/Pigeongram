/**
 * The public API plane: a Pages Function that forwards `/api/*` to the worker
 * through the `API_WORKER` service binding (declared in
 * `pages/wrangler.template.jsonc`).
 *
 * Nothing under `/api/*` requires Cloudflare Access. Only `GET /api/health`
 * is served today; account data lives under `/user/*`, behind Access and the
 * worker's JWT verifier. The request is passed through untouched.
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
