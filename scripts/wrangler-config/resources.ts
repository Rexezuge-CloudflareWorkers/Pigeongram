/**
 * Creating the resources `wrangler.jsonc` names, and writing their real ids over
 * the placeholders.
 *
 * Provenance: ported from Edge-Sonic's `scripts/lib/wrangler-config/resources.ts`.
 *
 * The placeholder rule: a template carries an all-zero id meaning "resolve me",
 * and a config carrying one cannot be deployed. So provisioning walks the config,
 * creates what is missing, and patches the id in place. A placeholder with nothing
 * to create it *under* — a KV id with no binding, a D1 id with no name — is
 * refused rather than skipped, because a silently skipped placeholder is a deploy
 * that fails later with no link back to the reason.
 */

import { parse } from 'jsonc-parser';
import { parseWranglerTableRows } from '../lib/wrangler-table.ts';
import {
  DEFAULT_HEX_ID,
  DEFAULT_KV_NAMESPACE_NAMES,
  DEFAULT_SECRET_STORE_NAME,
  DEFAULT_UUID,
  DEFAULT_WORKER_NAME,
  VECTORIZE_DIMENSIONS,
  type D1Database,
  type KVNamespace,
  type SecretStore,
  type WranglerConfig,
} from './types.ts';
import { parseJsonArray, runWrangler } from './cli.ts';
import { readConfig, writeConfig, writeConfigValue } from './patches.ts';

/**
What `ensure*` did, so a caller can act on the difference.
*/
export interface Provisioned {
  id: string;
  created: boolean;
}

/**
The id a D1 database is reported under, whichever key the CLI used.
*/
export function getD1Id(database: D1Database): string | undefined {
  return database.uuid ?? database.database_id ?? database.id;
}

export function listD1Databases(): D1Database[] {
  return parseJsonArray<D1Database>(runWrangler(['d1', 'list', '--json']), 'wrangler d1 list --json');
}

/**
 * The D1 database `binding` names, created when it does not exist.
 *
 * Whether it was created is reported, not inferred: a database created moments ago
 * holds no user data, so a backup workflow must refuse to upload its empty dump.
 * The caller cannot re-derive that from the config, because this very function
 * patches the placeholder away before the reader ever runs.
 */
export function ensureD1Database(databaseName: string): Provisioned {
  let database = listD1Databases().find((candidate) => candidate.name === databaseName);
  let created = false;
  if (database === undefined) {
    console.log(`Creating D1 database: ${databaseName}`);
    runWrangler(['d1', 'create', databaseName]);
    database = listD1Databases().find((candidate) => candidate.name === databaseName);
    created = true;
  }
  const databaseId = database === undefined ? undefined : getD1Id(database);
  if (databaseId === undefined || databaseId === '') {
    throw new Error(`Unable to discover D1 database ID for ${databaseName}.`);
  }
  return { id: databaseId, created };
}

export function listKVNamespaces(): KVNamespace[] {
  return parseJsonArray<KVNamespace>(runWrangler(['kv', 'namespace', 'list']), 'wrangler kv namespace list');
}

/**
 * The namespace name a binding's namespace is created under.
 *
 * `namespaceNames` is the binding → namespace map, defaulting to the kit's
 * `DEFAULT_KV_NAMESPACE_NAMES`. A consumer whose namespaces predate that convention
 * passes its own, so provisioning finds the namespace that already holds the data
 * instead of creating an empty one beside it and binding the worker to the new one.
 */
export function getKVNamespaceName(
  config: WranglerConfig,
  binding: string,
  namespaceNames: Record<string, string> = DEFAULT_KV_NAMESPACE_NAMES,
): string {
  return namespaceNames[binding] ?? `${config.name ?? DEFAULT_WORKER_NAME}-${binding.toLowerCase()}`;
}

export function ensureKVNamespace(
  config: WranglerConfig,
  binding: string,
  namespaceNames: Record<string, string> = DEFAULT_KV_NAMESPACE_NAMES,
): Provisioned {
  const namespaceName = getKVNamespaceName(config, binding, namespaceNames);
  const candidateNames = new Set([namespaceName, `${config.name ?? DEFAULT_WORKER_NAME}-${binding}`, binding]);
  let namespace = listKVNamespaces().find((candidate) => {
    const candidateName = candidate.title ?? candidate.name;
    return candidate.id !== undefined && candidateName !== undefined && candidateNames.has(candidateName);
  });
  let created = false;
  if (namespace === undefined) {
    console.log(`Creating KV namespace: ${namespaceName}`);
    runWrangler(['kv', 'namespace', 'create', namespaceName]);
    namespace = listKVNamespaces().find((candidate) => candidate.id !== undefined && (candidate.title ?? candidate.name) === namespaceName);
    created = true;
  }
  if (namespace?.id === undefined) {
    throw new Error(`Unable to discover KV namespace ID for ${namespaceName}.`);
  }
  return { id: namespace.id, created };
}

/**
The bindings a deployment always needs, whether or not a custom config lists them.
*/
export function getRequiredKvBindings(namespaceNames: Record<string, string> = DEFAULT_KV_NAMESPACE_NAMES): string[] {
  return Object.keys(namespaceNames);
}

/**
 * Add the always-needed KV bindings a hand-written config left out.
 *
 * A config supplied through `WRANGLER_JSONC` is edited by hand and drifts; without
 * this the worker starts with an unbound `CACHE` and fails on the first read.
 */
export function ensureRequiredKvBindings(
  content: string,
  config: WranglerConfig,
  namespaceNames: Record<string, string> = DEFAULT_KV_NAMESPACE_NAMES,
): string {
  const existing = new Set((config.kv_namespaces ?? []).map((namespace) => namespace.binding).filter((binding) => binding !== undefined));
  const missing = getRequiredKvBindings(namespaceNames).filter((binding) => !existing.has(binding));
  if (missing.length === 0) {
    return content;
  }
  const next = [...(config.kv_namespaces ?? [])];
  for (const binding of missing) {
    console.log(`Adding missing KV namespace binding: ${binding}`);
    next.push({ binding, id: DEFAULT_HEX_ID });
  }
  return writeConfigValue(content, ['kv_namespaces'], next);
}

/**
The stores in a `secrets-store store list` table.
*/
export function parseSecretStoresTable(output: string): SecretStore[] {
  const stores: SecretStore[] = [];
  // Through the shared table parser rather than a second inline split: `wrangler`
  // renders through `cli-table3`, whose cells are separated by U+2502 and are *not*
  // space-aligned, so a parser written for aligned output silently matches nothing
  // — which reads as "the store does not exist" and makes provisioning create a
  // duplicate.
  for (const row of parseWranglerTableRows(output)) {
    // `.at()` rather than indexing: a short row is possible when the table
    // shape drifts, and the guards below are what skip it.
    const name = row.at(0);
    const id = row.at(1);
    // Store ids are 32 hex characters; a row without one is a header, a border, or
    // an unrelated column, and is skipped rather than stored with an undefined id.
    if (name !== undefined && id !== undefined && /^[a-f0-9]{32}$/i.test(id)) {
      stores.push({ name, id });
    }
  }
  return stores;
}

export function listSecretStores(): SecretStore[] {
  const output = runWrangler(['secrets-store', 'store', 'list', '--remote']);
  try {
    return parseJsonArray<SecretStore>(output, 'wrangler secrets-store store list --remote');
  } catch {
    // The subcommand prints a table rather than JSON on some versions.
    return parseSecretStoresTable(output);
  }
}

export function ensureSecretStore(): string {
  const stores = listSecretStores();
  const existing = stores.find((candidate) => candidate.name === DEFAULT_SECRET_STORE_NAME) ?? stores.at(0);
  if (existing !== undefined) {
    return existing.id;
  }
  console.log(`Creating Secrets Store: ${DEFAULT_SECRET_STORE_NAME}`);
  const output = runWrangler(['secrets-store', 'store', 'create', DEFAULT_SECRET_STORE_NAME, '--remote']);
  const createdStoreId = /ID:\s*([a-f0-9]{32})/i.exec(output)?.[1];
  if (createdStoreId !== undefined) {
    return createdStoreId;
  }
  // The create output did not name the id, so read it back rather than guessing.
  const refreshed = listSecretStores();
  const store = refreshed.find((candidate) => candidate.name === DEFAULT_SECRET_STORE_NAME) ?? refreshed.at(0);
  if (store?.id === undefined) {
    throw new Error(`Unable to discover Secrets Store ID for ${DEFAULT_SECRET_STORE_NAME}.`);
  }
  return store.id;
}

/**
Create a queue when it is absent, reporting whether it had to be created.
*/
export function ensureQueue(queueName: string): boolean {
  try {
    runWrangler(['queues', 'info', queueName]);
    console.log(`Queue ${queueName} already exists.`);
    return false;
  } catch {
    console.log(`Creating queue: ${queueName}`);
    runWrangler(['queues', 'create', queueName]);
    return true;
  }
}

/**
 * Queue names a deployment needs, in first-seen order.
 *
 * Producers and consumers name the same queue twice — one queue, two roles — and a
 * name appearing in both must be created once. Pure so it is testable without
 * wrangler.
 */
export function queueNamesIn(config: WranglerConfig): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const producer of config.queues?.producers ?? []) {
    if (producer.queue === '' || seen.has(producer.queue)) continue;
    seen.add(producer.queue);
    names.push(producer.queue);
  }
  for (const consumer of config.queues?.consumers ?? []) {
    if (consumer.queue === '' || seen.has(consumer.queue)) continue;
    seen.add(consumer.queue);
    names.push(consumer.queue);
  }
  return names;
}

export function ensureVectorizeIndex(indexName: string, dimensions: number): void {
  try {
    runWrangler(['vectorize', 'info', indexName]);
    console.log(`Vectorize index ${indexName} already exists.`);
  } catch {
    console.log(`Creating Vectorize index: ${indexName} with ${dimensions} dimensions`);
    runWrangler(['vectorize', 'create', indexName, `--dimensions=${dimensions}`, '--metric=cosine']);
  }
}

/**
Replace each placeholder D1 `database_id` with a real one.
*/
function provisionD1Databases(content: string, config: WranglerConfig, created: string[]): string {
  let patched = content;
  for (const [index, database] of config.d1_databases?.entries() ?? []) {
    if (database.database_id !== DEFAULT_UUID) continue;
    if (database.database_name === undefined || database.database_name === '') {
      throw new Error(`D1 database binding ${database.binding ?? index} has a placeholder database_id but no database_name.`);
    }
    const resolved = ensureD1Database(database.database_name);
    if (resolved.created) {
      created.push(`d1:${database.database_name}`);
    }
    console.log(`Using D1 database ${database.database_name}: ${resolved.id}`);
    patched = writeConfigValue(patched, ['d1_databases', index, 'database_id'], resolved.id);
  }
  return patched;
}

/**
Replace each placeholder KV namespace id with a real one.
*/
function provisionKvNamespaces(content: string, config: WranglerConfig, created: string[], namespaceNames: Record<string, string>): string {
  let patched = content;
  for (const [index, namespace] of config.kv_namespaces?.entries() ?? []) {
    if (namespace.id !== DEFAULT_HEX_ID) continue;
    if (namespace.binding === undefined || namespace.binding === '') {
      throw new Error(`KV namespace at index ${index} has a placeholder id but no binding.`);
    }
    const resolved = ensureKVNamespace(config, namespace.binding, namespaceNames);
    const namespaceName = getKVNamespaceName(config, namespace.binding, namespaceNames);
    if (resolved.created) {
      created.push(`kv:${namespaceName}`);
    }
    console.log(`Using KV namespace ${namespaceName}: ${resolved.id}`);
    patched = writeConfigValue(patched, ['kv_namespaces', index, 'id'], resolved.id);
  }
  return patched;
}

/**
 * Point every placeholder Secrets Store `store_id` at one store, creating it if
 * absent. `existed` is read **before** the create, because whether the store was
 * created is what the caller reports.
 */
function provisionSecretStore(content: string, config: WranglerConfig, created: string[]): string {
  const placeholders = (config.secrets_store_secrets ?? [])
    .map((secret, index) => ({ secret, index }))
    .filter(({ secret }) => secret.store_id === DEFAULT_HEX_ID);
  if (placeholders.length === 0) {
    return content;
  }
  const existed = listSecretStores().some((store) => store.name === DEFAULT_SECRET_STORE_NAME);
  const storeId = ensureSecretStore();
  if (!existed) {
    created.push(`secrets-store:${DEFAULT_SECRET_STORE_NAME}`);
  }
  console.log(`Using Secrets Store: ${storeId}`);
  return placeholders.reduce(
    (patched, { index }) => writeConfigValue(patched, ['secrets_store_secrets', index, 'store_id'], storeId),
    content,
  );
}

/**
 * Create every resource the config names, and write the real ids over the
 * placeholders.
 *
 * `namespaceNames` is the binding → namespace map KV provisioning reconciles
 * against, defaulting to the kit's `DEFAULT_KV_NAMESPACE_NAMES`; a consumer whose
 * namespaces were named before that convention passes its own so the existing
 * namespace is found instead of a second empty one being created.
 *
 * Returns what it had to create, as `<kind>:<name>` — returned rather than logged,
 * because a caller acts on it: the backup workflow refuses to export a D1 database
 * that appears here, since one created moments ago holds no user data and an empty
 * dump uploaded on schedule is a false sense of safety.
 */
export function provisionWranglerResources(namespaceNames: Record<string, string> = DEFAULT_KV_NAMESPACE_NAMES): string[] {
  const created: string[] = [];
  let { content, config } = readConfig();

  content = ensureRequiredKvBindings(content, config, namespaceNames);
  config = parse(content) as WranglerConfig;

  // Each of the three below re-parses before it patches, because each writes into
  // the config text the previous one produced. They are separate functions because
  // they are separate resources with separate rules, and one loop holding all
  // three would read as a single resource list with the differences hidden in the
  // bodies.
  content = provisionD1Databases(content, config, created);
  config = parse(content) as WranglerConfig;

  content = provisionKvNamespaces(content, config, created, namespaceNames);
  config = parse(content) as WranglerConfig;

  content = provisionSecretStore(content, config, created);

  writeConfig(content);

  config = parse(content) as WranglerConfig;
  for (const queueName of queueNamesIn(config)) {
    if (ensureQueue(queueName)) {
      created.push(`queue:${queueName}`);
    }
  }

  // Vectorize indexes are name-based, so nothing in the file is patched — but the
  // created names are still reported like every other resource, so a deploy log
  // shows what appeared.
  for (const binding of config.vectorize ?? []) {
    ensureVectorizeIndex(binding.index_name, VECTORIZE_DIMENSIONS);
  }

  return created;
}
