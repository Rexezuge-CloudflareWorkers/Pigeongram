/**
 * Reading, writing and patching `wrangler.jsonc`.
 *
 * Provenance: ported from Edge-Sonic's `scripts/lib/wrangler-config/patches.ts`.
 *
 * The config is JSONC — `//` comments and trailing commas — so it is edited
 * through jsonc-parser's `modify`/`applyEdits` rather than parsed and re-serialized.
 * A round trip through `JSON.parse` would drop every comment and reformat the
 * file, which is a diff nobody can review and a reason to regenerate the config by
 * hand instead.
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { CONFIG_PATH, TEMPLATE_PATH, type WranglerConfig } from './types.ts';

/**
The config's current text and its parsed form.
*/
export interface ConfigFile {
  content: string;
  config: WranglerConfig;
}

export function readConfig(): ConfigFile {
  const content = readFileSync(CONFIG_PATH, 'utf8');
  return { content, config: parse(content) as WranglerConfig };
}

/**
 * Apply one edit to the config text, preserving comments and formatting.
 */
export function writeConfigValue(content: string, path: Array<string | number>, value: unknown): string {
  const edits = modify(content, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } });
  return applyEdits(content, edits);
}

/**
Write the config, guaranteeing a trailing newline so Prettier sees a fixed point.
*/
export function writeConfig(content: string): void {
  writeFileSync(CONFIG_PATH, content.endsWith('\n') ? content : `${content}\n`);
}

/**
 * The top-level keys a caller wants to merge into the config, from the environment.
 *
 * `WRANGLER_PATCH_JSON` is how a repository variable supplies per-environment
 * settings without a second file: a repo with one worker and three environments
 * patches the routes and the vars rather than keeping three templates in step.
 */
export function parseTopLevelPatch(): Record<string, unknown> | undefined {
  return parseJsonObject(process.env['WRANGLER_PATCH_JSON'], 'WRANGLER_PATCH_JSON', 'a JSON object');
}

/**
The `vars` entries a caller wants to merge, from the environment.
*/
export function parseVarsPatch(): Record<string, string> | undefined {
  const parsed = parseJsonObject(process.env['WRANGLER_VARS_PATCH_JSON'], 'WRANGLER_VARS_PATCH_JSON', 'a JSON object of string values');
  if (parsed === undefined) {
    return undefined;
  }
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim()) {
      throw new Error('WRANGLER_VARS_PATCH_JSON contains an empty variable name.');
    }
    if (typeof value !== 'string') {
      throw new TypeError(`WRANGLER_VARS_PATCH_JSON value for ${key} must be a string.`);
    }
    patch[key] = value;
  }
  return patch;
}

function parseJsonObject(raw: string | undefined, name: string, expected: string): Record<string, unknown> | undefined {
  if (raw === undefined || !raw.trim()) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${name} must be ${expected}.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be ${expected}.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * A path as a log line should name it: relative to the working directory the
 * script was invoked from, which is the repo root in every consumer.
 */
function displayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}

/**
 * Materialize the config: the repository variable when it is set, otherwise the
 * committed template.
 */
export function prepareConfigFile(): void {
  const dumpedConfig = process.env['WRANGLER_JSONC'];
  if (dumpedConfig?.trim()) {
    writeConfig(dumpedConfig);
    console.log('Wrote wrangler.jsonc from WRANGLER_JSONC repository variable.');
    return;
  }
  copyFileSync(TEMPLATE_PATH, CONFIG_PATH);
  console.log(`WRANGLER_JSONC is empty; copied ${displayPath(TEMPLATE_PATH)} to ${displayPath(CONFIG_PATH)}.`);
}

/**
 * Refuse a config older than the template requires.
 *
 * The template is the one file in the repo that says which wrangler behaviour the
 * worker was written against, and a config written by an older template can name
 * bindings the worker no longer reads. Failing here rather than at deploy time is
 * the whole reason the check exists.
 */
export function ensureMinimumConfigVersion(): void {
  const template = parse(readFileSync(TEMPLATE_PATH, 'utf8')) as { $minimumVersion?: unknown };
  if (typeof template.$minimumVersion !== 'number') {
    return;
  }
  const { config } = readConfig();
  const currentVersion = config.$version;
  if (typeof currentVersion !== 'number' || currentVersion < template.$minimumVersion) {
    throw new Error(
      `wrangler.jsonc version (${typeof currentVersion === 'number' ? currentVersion : 'missing'}) is below minimum template version (${template.$minimumVersion}). Regenerate it from ${displayPath(TEMPLATE_PATH)}.`,
    );
  }
}

export function applyTopLevelPatch(): void {
  const patch = parseTopLevelPatch();
  const entries = Object.entries(patch ?? {});
  if (entries.length === 0) {
    return;
  }
  let { content } = readConfig();
  for (const [key, value] of entries) {
    content = writeConfigValue(content, [key], value);
  }
  writeConfig(content);
  console.log(`Applied ${entries.length} Wrangler top-level patch entr${entries.length === 1 ? 'y' : 'ies'}.`);
}

export function applyVarsPatch(): void {
  const patch = parseVarsPatch();
  const entries = Object.entries(patch ?? {});
  if (entries.length === 0) {
    return;
  }
  const prepared = readConfig();
  let content = prepared.content;
  if (
    prepared.config.vars !== undefined &&
    (prepared.config.vars === null || typeof prepared.config.vars !== 'object' || Array.isArray(prepared.config.vars))
  ) {
    throw new Error('wrangler.jsonc vars must be an object before applying WRANGLER_VARS_PATCH_JSON.');
  }
  // `null` needs no branch here: the guard above throws for it, so by this
  // line `vars` is either absent or an object.
  if (prepared.config.vars === undefined) {
    content = writeConfigValue(content, ['vars'], {});
  }
  for (const [key, value] of entries) {
    content = writeConfigValue(content, ['vars', key], value);
  }
  writeConfig(content);
  console.log(`Applied ${entries.length} Wrangler vars patch entr${entries.length === 1 ? 'y' : 'ies'}.`);
}
