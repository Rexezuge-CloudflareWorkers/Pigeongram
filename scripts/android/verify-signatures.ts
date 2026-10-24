/**
 * Verifies that both artifacts carry this deployment's signing certificate.
 *
 * Bubblewrap signs the APK with `apksigner` and the AAB with `jarsigner`, so the
 * two are checked through the tool that produced them. The comparison uses the
 * canonical fingerprint form because the tools disagree about separators:
 * `apksigner` prints bare hex, `keytool` prints colon-separated groups.
 *
 * The step also writes `SHA256SUMS` beside the artifacts, which is what the
 * runbook's `sha256sum -c` verifies after a download.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { commandFailure, REPOSITORY_ROOT, requiredEnv, runStep } from './actions.ts';
import { normalizeFingerprint, parseApksignerFingerprint, parseKeytoolFingerprint } from './fingerprint.ts';

const APK_NAME = 'app-release-signed.apk';
const AAB_NAME = 'app-release-bundle.aab';

function run(command: string, args: readonly string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`${path.basename(command)} failed: ${commandFailure(error)}`);
  }
}

/**
 * Picks the newest build-tools release that ships `apksigner`.
 *
 * Ordering is numeric, not lexical: `36.1.0` must beat `36.0.0`, and a lexical
 * sort would also put `36.10.0` before `36.9.0`. This mirrors the `sort -V` the
 * workflow used before the logic moved here.
 */
export function findApksigner(sdkRoot: string): string {
  const buildToolsDirectory = path.join(sdkRoot, 'build-tools');
  let versions: string[];
  try {
    versions = readdirSync(buildToolsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    throw new Error(`No build-tools directory under ${sdkRoot}`);
  }

  const installed = versions
    .filter((version) => existsSync(path.join(buildToolsDirectory, version, 'apksigner')))
    .toSorted((left, right) => left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' }));
  const newest = installed.at(-1);
  if (!newest) {
    throw new Error('apksigner not found');
  }
  return path.join(buildToolsDirectory, newest, 'apksigner');
}

/**
 * Writes the `sha256sum`-format manifest for the given artifact names.
 */
export function writeChecksumManifest(directory: string, names: readonly string[]): string {
  const lines = names.map((name) => {
    const digest = createHash('sha256')
      .update(readFileSync(path.join(directory, name)))
      .digest('hex');
    return `${digest}  ${name}`;
  });
  const content = `${lines.join('\n')}\n`;
  writeFileSync(path.join(directory, 'SHA256SUMS'), content);
  return content;
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android build', () => {
    const sdkRoot = requiredEnv('ANDROID_SDK_ROOT');
    const expected = normalizeFingerprint(requiredEnv('ANDROID_KEYSTORE_FINGERPRINT'));
    const buildDirectory = path.join(REPOSITORY_ROOT, 'android', 'build');
    const apk = path.join(buildDirectory, APK_NAME);
    const aab = path.join(buildDirectory, AAB_NAME);

    const apksigner = findApksigner(sdkRoot);
    const apksignerOutput = run(apksigner, ['verify', '--verbose', '--print-certs', apk]);
    process.stdout.write(apksignerOutput);

    const apkFingerprint = parseApksignerFingerprint(apksignerOutput);
    if (!apkFingerprint) {
      throw new Error('Could not read the APK signer fingerprint');
    }
    if (apkFingerprint !== expected) {
      throw new Error('The APK signer fingerprint does not match the keystore');
    }

    // `jarsigner` prints its verdict on stdout and warnings on stderr; the exit
    // status is the check, so only the warnings are worth showing.
    try {
      execFileSync('jarsigner', ['-verify', aab], {
        stdio: ['ignore', 'ignore', 'inherit'],
      });
    } catch (error) {
      throw new Error(`jarsigner failed: ${commandFailure(error)}`);
    }

    const aabCertificate = run('keytool', ['-printcert', '-jarfile', aab]);
    const aabFingerprint = parseKeytoolFingerprint(aabCertificate);
    if (aabFingerprint !== expected) {
      throw new Error('The AAB signer fingerprint does not match the keystore');
    }

    process.stdout.write(writeChecksumManifest(buildDirectory, [APK_NAME, AAB_NAME]));
  });
}
