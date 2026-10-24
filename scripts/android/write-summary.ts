/**
 * Writes the run's build summary to `$GITHUB_STEP_SUMMARY`.
 *
 * The summary is the one place a reader lands after a successful build, so it
 * records the identity that was baked into the APK — the origin, package id,
 * version and certificate — rather than repeating the step list.
 */

import { appendFileSync } from 'node:fs';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { requiredEnv, runStep } from './actions.ts';

export interface BuildSummary {
  readonly origin: string;
  readonly packageId: string;
  readonly appName: string;
  readonly versionName: string;
  readonly versionCode: string;
  readonly fingerprint: string;
}

function cell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Renders the Markdown the Actions run view displays.
 */
export function renderBuildSummary(summary: BuildSummary): string {
  return [
    '## Android build',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Origin | \`${cell(summary.origin)}\` |`,
    `| Package id | \`${cell(summary.packageId)}\` |`,
    `| App name | ${cell(summary.appName)} |`,
    `| Version | \`${cell(summary.versionName)}\` (${cell(summary.versionCode)}) |`,
    `| Certificate SHA-256 | \`${cell(summary.fingerprint)}\` |`,
    '',
    'Download the APK and AAB from this run. This repository does not publish a signed build for another deployment.',
    '',
  ].join('\n');
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android summary', () => {
    const summary = renderBuildSummary({
      origin: requiredEnv('ANDROID_ORIGIN'),
      packageId: requiredEnv('ANDROID_PACKAGE_ID'),
      appName: requiredEnv('ANDROID_APP_NAME'),
      versionName: requiredEnv('VERSION_NAME'),
      versionCode: requiredEnv('VERSION_CODE'),
      fingerprint: requiredEnv('ANDROID_KEYSTORE_FINGERPRINT'),
    });

    const file = process.env.GITHUB_STEP_SUMMARY;
    if (file) {
      appendFileSync(file, summary);
    } else {
      // A local run still shows what CI would have published.
      process.stdout.write(summary);
    }
  });
}
