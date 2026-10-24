/**
 * Writes Bubblewrap's JDK/SDK configuration and lets it validate the pair.
 *
 * Bubblewrap reads (and, when the file is missing, *prompts for*) this
 * configuration before it runs any command, including `--version`. The workflow
 * therefore installs it first and invokes Bubblewrap only here; a version probe
 * in an earlier step would hit the prompt with stdin closed and crash.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { commandFailure, requiredEnv, runStep } from './actions.ts';

/**
 * The config Bubblewrap reads from `~/.bubblewrap/config.json`.
 */
export interface BubblewrapConfig {
  readonly jdkPath: string;
  readonly androidSdkPath: string;
}

function assertDirectory(label: string, value: string): string {
  try {
    if (statSync(value).isDirectory()) {
      return value;
    }
  } catch {
    // Fall through to the shared message below.
  }
  throw new Error(`${label} is not a directory`);
}

/**
 * Writes the config file and returns its path.
 *
 * The values are the ones Bubblewrap itself would have collected from its
 * interactive prompt, so the rest of the workflow never sees a prompt.
 */
export function writeBubblewrapConfig(home: string, config: BubblewrapConfig): string {
  const directory = path.join(home, '.bubblewrap');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'config.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

if (isEntrypoint(import.meta.url)) {
  runStep('Bubblewrap', () => {
    const jdkPath = assertDirectory('JAVA_HOME', requiredEnv('JAVA_HOME'));
    const androidSdkPath = assertDirectory('ANDROID_SDK_ROOT', requiredEnv('ANDROID_SDK_ROOT'));
    const home = os.homedir();

    const file = writeBubblewrapConfig(home, { jdkPath, androidSdkPath });
    console.log(`Wrote ${file}.`);

    for (const args of [['--version'], ['doctor']] as const) {
      try {
        execFileSync('bubblewrap', args, { stdio: 'inherit' });
      } catch (error) {
        throw new Error(`bubblewrap ${args.join(' ')} failed: ${commandFailure(error)}`);
      }
    }
  });
}
