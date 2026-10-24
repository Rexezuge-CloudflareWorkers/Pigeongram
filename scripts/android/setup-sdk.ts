/**
 * Installs the Android platform and build tools this Bubblewrap release targets.
 *
 * The `ubuntu-latest` image carries an SDK, but not necessarily the packages
 * `bubblewrap build` needs. Two details are load-bearing:
 *
 * - Build-tools `36.1.0` is the release Bubblewrap `1.27.0` pins; installing it
 *   up front keeps the build from fetching it itself.
 * - Bubblewrap `1.27.0` predates the `cmdline-tools`-only layout: `doctor` and
 *   `build` both require `<sdk>/tools` or `<sdk>/bin`, and the runner image has
 *   neither. Exposing `cmdline-tools/latest/bin` as `<sdk>/bin` satisfies the
 *   check and gives Bubblewrap the `sdkmanager` fallback it expects.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { appendEnv, commandFailure, runStep } from './actions.ts';

/** The SDK location the GitHub-hosted Linux image uses. */
export const DEFAULT_SDK_ROOT = '/usr/local/lib/android/sdk';

/** The platform Bubblewrap `1.27.0` compiles against. */
export const ANDROID_PLATFORM = 'android-36';

/** The build-tools release that Bubblewrap `1.27.0` pins. */
export const BUILD_TOOLS_VERSION = '36.1.0';

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chooses the SDK root, preferring the runner's own variable over the default.
 */
export function resolveSdkRoot(env: NodeJS.ProcessEnv): string {
  return env.ANDROID_SDK_ROOT?.trim() || env.ANDROID_HOME?.trim() || DEFAULT_SDK_ROOT;
}

/**
 * Finds `sdkmanager`: the SDK's bundled copy first, then whatever is on `PATH`.
 *
 * The bundled path is checked explicitly because the runner image sets neither
 * `ANDROID_SDK_ROOT` nor a `cmdline-tools` symlink consistently, and `PATH` may
 * hold a wrapper that points somewhere else.
 */
export function findSdkManager(sdkRoot: string, env: NodeJS.ProcessEnv): string {
  const bundled = path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager');
  if (isExecutable(bundled)) {
    return bundled;
  }
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, 'sdkmanager');
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  throw new Error('sdkmanager not found');
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android SDK', () => {
    const sdkRoot = resolveSdkRoot(process.env);
    if (!existsSync(sdkRoot)) {
      throw new Error(`No Android SDK found at ${sdkRoot}`);
    }
    const sdkManager = findSdkManager(sdkRoot, process.env);

    // The licenses command asks one question per package and exits non-zero
    // after the last one even when every answer was accepted, so its status is
    // deliberately ignored; the install below is the real check.
    spawnSync(sdkManager, ['--sdk_root=' + sdkRoot, '--licenses'], {
      input: 'y\n'.repeat(256),
      stdio: ['pipe', 'ignore', 'ignore'],
    });

    try {
      execFileSync(
        sdkManager,
        ['--sdk_root=' + sdkRoot, '--install', 'platform-tools', `platforms;${ANDROID_PLATFORM}`, `build-tools;${BUILD_TOOLS_VERSION}`],
        { stdio: 'inherit' },
      );
    } catch (error) {
      throw new Error(`sdkmanager could not install the Android packages: ${commandFailure(error)}`);
    }

    if (!existsSync(path.join(sdkRoot, 'bin')) && !existsSync(path.join(sdkRoot, 'tools'))) {
      symlinkSync(path.dirname(sdkManager), path.join(sdkRoot, 'bin'), 'dir');
    }

    appendEnv({ ANDROID_SDK_ROOT: sdkRoot });
    console.log(`Android SDK ready at ${sdkRoot} (${ANDROID_PLATFORM}, build-tools ${BUILD_TOOLS_VERSION}).`);
  });
}
