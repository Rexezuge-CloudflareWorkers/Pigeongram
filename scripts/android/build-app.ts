/**
 * Builds the rendered WebView project with Gradle.
 *
 * The native project is a plain Gradle build, so this script is the single
 * place that names its tasks and the two artifact paths the signature check
 * and the workflow upload expect.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { commandFailure, REPOSITORY_ROOT, runStep } from './actions.ts';

export const APK_NAME = 'app-release-signed.apk';
export const AAB_NAME = 'app-release-bundle.aab';

/** Gradle's own outputs, before they are copied to the published names. */
export function gradleArtifactPaths(buildDirectory: string): readonly { readonly from: string; readonly to: string }[] {
  return [
    {
      from: path.join(buildDirectory, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
      to: path.join(buildDirectory, APK_NAME),
    },
    {
      from: path.join(buildDirectory, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'),
      to: path.join(buildDirectory, AAB_NAME),
    },
  ];
}

/** `--no-daemon` keeps the runner from leaving a Gradle process behind. */
export function gradleArgs(tasks: readonly string[]): readonly string[] {
  return ['--no-daemon', '--warning-mode=all', ...tasks];
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android build', () => {
    const buildDirectory = path.join(REPOSITORY_ROOT, 'android', 'build');
    try {
      execFileSync('gradle', gradleArgs(['assembleRelease', 'bundleRelease']), {
        cwd: buildDirectory,
        stdio: 'inherit',
      });
    } catch (error) {
      throw new Error(`gradle failed: ${commandFailure(error)}`);
    }
    for (const artifact of gradleArtifactPaths(buildDirectory)) {
      copyFileSync(artifact.from, artifact.to);
      console.log(`Built ${path.basename(artifact.to)}.`);
    }
  });
}
