/**
 * The build's configuration: the values that end up in the APK's identity.
 *
 * Everything here is validated before a keystore is decoded or a URL fetched, so
 * a typo in a repository variable fails in seconds with the variable's name
 * instead of after an Android build with a manifest merger error. The rules are
 * the TWA's own: an https origin with no path, a reverse-DNS package id, and an
 * Android version name/code pair.
 */

import { execFileSync } from 'node:child_process';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { appendEnv, REPOSITORY_ROOT, runStep } from './actions.ts';

/**
 * Android's application id rules: at least two dot-separated segments, each
 * starting with a letter, then letters, digits or underscores.
 */
const PACKAGE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

/**
 * Android accepts letters, digits, dot, underscore, plus and hyphen in a version
 * name; starting with a separator makes a confusing Play listing.
 */
const VERSION_NAME_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/** Play stores a version code in a signed 32-bit field; this is its ceiling. */
const MAX_VERSION_CODE = 2_100_000_000;

export interface AndroidBuildConfig {
  /** `https://host`, normalized by the URL parser. */
  readonly origin: string;
  /** `host`, without the scheme. */
  readonly host: string;
  readonly packageId: string;
  readonly appName: string;
  readonly launcherName: string;
  readonly versionName: string;
  readonly versionCode: number;
}

export interface BuildConfigOptions {
  readonly env: NodeJS.ProcessEnv;
  /** Where `git describe` runs; defaults to this repository. */
  readonly repositoryRoot?: string;
}

/**
 * Resolves the user-facing version name.
 *
 * The input wins; otherwise the latest tag, because the shell ships with the web
 * release it points at. A repository with no tags — every fresh fork — gets a
 * value derived from the run number instead of failing the build.
 */
export function resolveVersionName(env: NodeJS.ProcessEnv, repositoryRoot: string = REPOSITORY_ROOT): string {
  const supplied = env.INPUT_VERSION_NAME?.trim() ?? '';
  if (supplied) {
    return supplied;
  }

  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return tag.replace(/^v/, '');
  } catch {
    return `0.0.0-dev.${env.GITHUB_RUN_NUMBER ?? ''}`;
  }
}

/**
 * Reads and validates the whole build configuration.
 *
 * The secrets are included even though none of them is used in this step: the
 * point is to fail before the build with a list of everything a deployment has
 * not set, rather than one missing value per run.
 */
export function readBuildConfig({ env, repositoryRoot = REPOSITORY_ROOT }: BuildConfigOptions): AndroidBuildConfig {
  const required = {
    ANDROID_PWA_ORIGIN: 'repository variable',
    ANDROID_PACKAGE_ID: 'repository variable',
    ANDROID_CERT_SHA256: 'repository variable',
    ANDROID_KEYSTORE_BASE64: 'repository secret',
    ANDROID_KEYSTORE_PASSWORD: 'repository secret',
    ANDROID_KEY_ALIAS: 'repository secret',
    ANDROID_KEY_PASSWORD: 'repository secret',
  } as const;

  const missing = Object.entries(required)
    .filter(([name]) => !env[name]?.trim())
    .map(([name, kind]) => `${name} (${kind})`);
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(', ')}`);
  }

  let origin: URL;
  try {
    origin = new URL((env.ANDROID_PWA_ORIGIN ?? '').trim());
  } catch {
    throw new Error('ANDROID_PWA_ORIGIN must be an absolute https URL');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('ANDROID_PWA_ORIGIN must be an https origin with no path, port, query or fragment');
  }

  const packageId = (env.ANDROID_PACKAGE_ID ?? '').trim();
  if (!PACKAGE_ID_PATTERN.test(packageId)) {
    throw new Error('ANDROID_PACKAGE_ID must be a reverse-DNS application id');
  }

  const appName = env.ANDROID_APP_NAME?.trim() ?? '';
  if (!appName || appName.length > 50) {
    throw new Error('ANDROID_APP_NAME must be 1-50 characters');
  }
  const launcherName = env.ANDROID_LAUNCHER_NAME?.trim() ?? '';
  if (!launcherName || launcherName.length > 12) {
    throw new Error('ANDROID_LAUNCHER_NAME must be 1-12 characters');
  }

  const versionName = resolveVersionName(env, repositoryRoot);
  if (!VERSION_NAME_PATTERN.test(versionName)) {
    throw new Error('version_name must start with a letter or digit and contain only letters, digits, dot, underscore, plus or hyphen');
  }

  const versionCode = (env.INPUT_VERSION_CODE?.trim() || env.GITHUB_RUN_NUMBER || '').trim();
  const numericVersionCode = Number(versionCode);
  if (
    !/^[0-9]+$/.test(versionCode) ||
    !Number.isInteger(numericVersionCode) ||
    numericVersionCode < 1 ||
    numericVersionCode > MAX_VERSION_CODE
  ) {
    throw new Error(`version_code must be an integer between 1 and ${MAX_VERSION_CODE}`);
  }

  return {
    origin: origin.origin,
    host: origin.host,
    packageId,
    appName,
    launcherName,
    versionName,
    versionCode: numericVersionCode,
  };
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android configuration', () => {
    const config = readBuildConfig({ env: process.env });
    appendEnv({
      ANDROID_ORIGIN: config.origin,
      ANDROID_HOST: config.host,
      VERSION_NAME: config.versionName,
      VERSION_CODE: String(config.versionCode),
    });
    console.log(`Building ${config.packageId} ${config.versionName} (${config.versionCode}) for ${config.origin}`);
  });
}
