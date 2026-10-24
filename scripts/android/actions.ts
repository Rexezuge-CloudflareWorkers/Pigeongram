/**
 * Shared plumbing for the Android Build workflow's scripts.
 *
 * The workflow is a sequence of commands; the decisions behind each command live
 * in a script beside this file, so a step reads as one line of YAML and its rules
 * are unit-testable. This module holds only what every step needs: where the
 * repository is, how a failure is reported, and how a value reaches a later step.
 *
 * Nothing here reads a secret into a log line or interpolates a value into a
 * shell command: the scripts are spawned by `pnpm exec tsx`, not evaluated as
 * bash, so a variable containing shell metacharacters cannot alter a command.
 */

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The repository root, resolved from this file rather than the caller's cwd.
 *
 * `pnpm exec tsx scripts/android/…` happens to run from the root today, but a
 * `working-directory:` on a step — or a local run from another folder — must not
 * silently change which template gets rendered or where an artifact is read.
 */
export const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Runs one workflow step's logic and turns any thrown error into a failing step.
 *
 * The title is what the Actions UI shows beside the red X; keeping it per step
 * rather than per message is deliberate, because the reader already knows which
 * step ran and needs to know *why* it failed.
 *
 * Both synchronous and asynchronous entrypoints go through here, since the
 * preflight fetches over the network while the rest are synchronous.
 */
export function runStep(title: string, main: () => void | Promise<void>): void {
  const fail = (error: unknown): never => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error title=${title}::${message}\n`);
    process.exit(1);
  };

  try {
    const result = main();
    if (result) {
      void result.catch(fail);
    }
  } catch (error) {
    fail(error);
  }
}

/**
 * Publishes values to the steps after this one through `GITHUB_ENV`.
 *
 * Outside Actions (a local run) there is no file to append to and the values are
 * simply gone, which matches how the operator scripts treat `GITHUB_OUTPUT`: the
 * run still reports what it did, it just cannot hand anything forward.
 */
export function appendEnv(values: Readonly<Record<string, string>>): void {
  const file = process.env.GITHUB_ENV;
  const lines = Object.entries(values).map(([name, value]) => {
    if (/[\r\n]/.test(value)) {
      throw new Error(`${name} must not contain a line break`);
    }
    return `${name}=${value}`;
  });
  if (!lines.length) {
    return;
  }
  if (file) {
    appendFileSync(file, `${lines.join('\n')}\n`);
  }
}

/**
 * Reads a required environment variable, trimmed.
 *
 * Every step repeats this instead of trusting the validation step: a script is
 * also runnable on its own, and a missing value should name the variable rather
 * than fail later with `undefined` in a path or a URL.
 */
export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * The message from a failed `execFileSync`, preferring what the command printed.
 *
 * Node's default error starts with the full command line, which buries the one
 * line the tool actually said (keytool's "alias does not exist", jarsigner's
 * "jar is unsigned"). The caller already names the command in its own message.
 */
export function commandFailure(error: unknown): string {
  const candidate = error as {
    readonly stderr?: string | Buffer;
    readonly stdout?: string | Buffer;
    readonly message?: string;
  };
  const stderr = candidate.stderr?.toString().trim();
  const stdout = candidate.stdout?.toString().trim();
  return stderr || stdout || candidate.message || String(error);
}
