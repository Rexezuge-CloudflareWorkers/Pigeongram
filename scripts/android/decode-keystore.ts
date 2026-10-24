/**
 * Decodes and checks the signing keystore.
 *
 * The decoded file and its fingerprint are passed to the later steps through
 * `GITHUB_ENV`. The fingerprint is published in the runbook's colon-separated
 * form, and the build's own certificate check compares canonical forms, so a
 * repository variable written either way works.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { appendEnv, commandFailure, requiredEnv, runStep } from './actions.ts';
import { formatFingerprint, normalizeFingerprint, parseKeytoolFingerprint } from './fingerprint.ts';

/**
 * Decodes the base64 secret into bytes.
 *
 * Whitespace is stripped first because the GitHub secret editor and
 * `base64 -w0` disagree about line breaks; an empty result means the secret was
 * never filled in.
 */
export function decodeKeystoreBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, '');
  if (!compact) {
    throw new Error('ANDROID_KEYSTORE_BASE64 is empty');
  }
  return Buffer.from(compact, 'base64');
}

function runKeytool(args: readonly string[]): string {
  try {
    return execFileSync('keytool', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`keytool failed: ${commandFailure(error)}`);
  }
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android keystore', () => {
    const base64 = requiredEnv('ANDROID_KEYSTORE_BASE64');
    const password = requiredEnv('ANDROID_KEYSTORE_PASSWORD');
    const alias = requiredEnv('ANDROID_KEY_ALIAS');
    const expected = normalizeFingerprint(requiredEnv('ANDROID_CERT_SHA256'));
    const runnerTemp = requiredEnv('RUNNER_TEMP');

    const keystorePath = path.join(runnerTemp, 'android-release.jks');
    const bytes = decodeKeystoreBase64(base64);
    if (bytes.length === 0) {
      throw new Error('ANDROID_KEYSTORE_BASE64 did not decode to a file');
    }
    writeFileSync(keystorePath, bytes, { mode: 0o600 });
    chmodSync(keystorePath, 0o600);

    // The password reaches keytool through its environment-read flag, never as
    // an argument: arguments are visible in the runner's process list.
    runKeytool(['-list', '-keystore', keystorePath, '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD', '-alias', alias]);

    const verbose = runKeytool(['-list', '-v', '-keystore', keystorePath, '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD', '-alias', alias]);
    const fingerprint = parseKeytoolFingerprint(verbose);
    if (!fingerprint) {
      throw new Error('Could not read the SHA-256 fingerprint');
    }
    if (fingerprint !== expected) {
      throw new Error('ANDROID_CERT_SHA256 does not match the keystore fingerprint');
    }

    const display = formatFingerprint(fingerprint);
    appendEnv({
      ANDROID_KEYSTORE_PATH: keystorePath,
      ANDROID_KEYSTORE_FINGERPRINT: display,
    });
    console.log(`Keystore fingerprint: ${display}`);
  });
}
