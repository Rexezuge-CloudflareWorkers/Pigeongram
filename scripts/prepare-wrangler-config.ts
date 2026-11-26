#!/usr/bin/env tsx
/**
 * Materialize `wrangler.jsonc` and provision what it refers to.
 *
 * Provenance: Durable-DAV's `scripts/prepare-wrangler-config.ts` and Edge-Sonic's
 * `scripts/deploy/prepare-wrangler-config.ts`, converged. The five ordered calls
 * live in `wrangler-config/`: read or copy the config, refuse one older than the
 * template requires, apply the caller's patches, then create whatever resources it
 * names and write their real ids over the placeholders. This file is only the
 * order; it has nothing else to do.
 *
 * Run by the deploy job before `wrangler deploy` and `wrangler pages deploy`,
 * so the materialized config is the one both builds target.
 *
 * Adapted from the kit: the published `created` output is kept for the family
 * shape, but this repository has no D1 database to back up. The Durable
 * Object's SQLite is covered by Cloudflare's point-in-time recovery, so no
 * backup workflow reads the output here.
 *
 * Usage, from the repo root:
 *
 * ```bash
 * pnpm exec tsx scripts/prepare-wrangler-config.ts
 * ```
 *
 * Environment:
 *
 * - `WRANGLER_JSONC` — the whole config, as a repository variable. When set it is
 *   written verbatim instead of copying the template.
 * - `WRANGLER_PATCH_JSON` — top-level keys merged into the config.
 * - `WRANGLER_VARS_PATCH_JSON` — `vars` entries merged into the config.
 */
import { setOutput } from './lib/github-actions.ts';
import { applyTopLevelPatch, applyVarsPatch, ensureMinimumConfigVersion, prepareConfigFile } from './wrangler-config/patches.ts';
import { provisionWranglerResources } from './wrangler-config/resources.ts';

prepareConfigFile();
ensureMinimumConfigVersion();
applyTopLevelPatch();
applyVarsPatch();
// Adapted from the kit: the empty KV map says this worker has no cache binding,
// so provisioning must not add the family default (`CACHE`) to a config that
// never declared one. See `provisionWranglerResources`'s `namespaceNames`.
const created = provisionWranglerResources({});

// Published as a step output for the family workflow shape. This repository
// declares no resources, so `created` is normally empty; the output is kept so
// a future deployment that adds one does not need to change the step contract.
setOutput('created', created.join(','));
console.log('Wrangler configuration is ready.');
