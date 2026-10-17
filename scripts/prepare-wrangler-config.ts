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
 * Run by the deploy job before `wrangler deploy`, and by the backup workflow
 * before `wrangler d1 export` — so the database a backup covers is resolved from
 * the same config the deploy targets, with no second `D1_DATABASE_ID` secret to
 * keep in sync.
 *
 * The one thing it does beyond calling is publish what
 * `provisionWranglerResources` created, which the backup workflow reads to refuse
 * exporting a database that did not exist until this run.
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

// Published as a step output rather than only printed. The backup workflow needs
// to know whether the D1 database *existed* or was created moments ago: a fresh one
// holds no user data, and uploading that empty dump every night is a false sense
// of safety. The alternative — re-reading the placeholder id out of
// `wrangler.jsonc` — is unreachable, because `provisionWranglerResources` patches
// the placeholder away before the reader ever runs.
setOutput('created', created.join(','));
console.log('Wrangler configuration is ready.');
