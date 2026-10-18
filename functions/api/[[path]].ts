/**
 * The bridge: a Pages Function that forwards `/api/*` to the worker through
 * the `API_WORKER` service binding (declared in
 * `pages/wrangler.template.jsonc`).
 *
 * Why a proxy at all: the worker has `workers_dev: false` and is reachable
 * only through this project, which is where Cloudflare Access lives. The
 * function adds nothing else — authentication is the worker's token gate until
 * Access exists, business logic is the session engine's.
 *
 * The request is passed through untouched, which is what makes the
 * `/api/updates` WebSocket upgrade work: the runtime forwards the upgrade and
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
