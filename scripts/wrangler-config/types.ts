/**
 * Shared paths, placeholders and shape definitions for the wrangler config helpers.
 *
 * Provenance: ported from Edge-Sonic's `scripts/lib/wrangler-config/types.ts`.
 * Every script that reads or writes `wrangler.jsonc` resolves it here, so the
 * backup workflow cannot end up inspecting a different file than the deploy
 * materialized.
 *
 * The paths default to `process.cwd()`, which is the repo root in every consumer:
 * the scripts run as `pnpm exec tsx scripts/deploy/…` from there. `WRANGLER_CONFIG_PATH`
 * / `WRANGLER_TEMPLATE_PATH` override them for a caller that is not in the repo
 * root, which is the one case the cwd default gets wrong.
 */

import path from 'node:path';

/**
The config the deploy targets.
*/
export const CONFIG_PATH = process.env['WRANGLER_CONFIG_PATH'] ?? path.join(process.cwd(), 'wrangler.jsonc');

/**
The committed template the config is materialized from.
*/
// Adapted from the kit: this repo's worker template lives at
// `worker/wrangler.template.jsonc` rather than the family's
// `apps/api/wrangler.template.jsonc`.
export const TEMPLATE_PATH = process.env['WRANGLER_TEMPLATE_PATH'] ?? path.join(process.cwd(), 'worker/wrangler.template.jsonc');

/**
 * The id a template carries for a D1 database that does not exist yet.
 *
 * `provisionWranglerResources` replaces it with a real id; the backup scripts
 * refuse to export while it is still in place, because a database that was just
 * created holds no user data.
 */
export const DEFAULT_UUID = '00000000-0000-0000-0000-000000000000';

/**
The placeholder for a KV namespace id and for a Secrets Store id.
*/
export const DEFAULT_HEX_ID = '00000000000000000000000000000000';

/**
The Secrets Store name a deployment uses.
*/
export const DEFAULT_SECRET_STORE_NAME = 'default';

/**
 * Fallback when the config declares no `name`, used to derive resource names.
 *
 * Overridable per consumer with `WRANGLER_WORKER_NAME`, which keeps the default
 * honest rather than baking one repo's name into the kit.
 */
export const DEFAULT_WORKER_NAME = process.env['WRANGLER_WORKER_NAME'] ?? 'my-worker';

/**
 * KV bindings a deployment always needs, and the namespace each maps to.
 *
 * The default for `provisionWranglerResources`'s `namespaceNames` argument: a
 * consumer whose worker has no cache binding passes an empty map, and one whose
 * namespaces predate this convention passes its own map.
 */
export const DEFAULT_KV_NAMESPACE_NAMES: Record<string, string> = {
  CACHE: `${DEFAULT_WORKER_NAME}-cache`,
};

/**
Dimensions of a Vectorize index this kit provisions.
*/
export const VECTORIZE_DIMENSIONS = 1024;

/**
 * The parsed shape of a wrangler config.
 *
 * `vars` is widened with `null` on purpose: jsonc-parser yields `null` for an
 * explicit `vars: null`, and the vars-patch path must be able to reject that
 * rather than treat the field as absent.
 */
export interface WranglerConfig {
  name?: string;
  $version?: number;
  vars?: Record<string, unknown> | null;
  d1_databases?: Array<{
    binding?: string;
    database_id?: string;
    database_name?: string;
  }>;
  kv_namespaces?: Array<{
    binding?: string;
    id?: string;
  }>;
  secrets_store_secrets?: Array<{
    binding?: string;
    store_id?: string;
    secret_name?: string;
  }>;
  queues?: {
    producers?: Array<{ binding: string; queue: string }>;
    consumers?: Array<{ queue: string }>;
  };
  vectorize?: Array<{
    binding: string;
    index_name: string;
  }>;
}

/**
A D1 database as `wrangler d1 list --json` reports one.
*/
export interface D1Database {
  name?: string;
  uuid?: string;
  id?: string;
  database_id?: string;
}

/**
A KV namespace as `wrangler kv namespace list` reports one.
*/
export interface KVNamespace {
  title?: string;
  name?: string;
  id?: string;
}

/**
A Secrets Store as `wrangler secrets-store store list` reports one.
*/
export interface SecretStore {
  name: string;
  id: string;
}
