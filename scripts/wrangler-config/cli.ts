/**
 * Running `wrangler` and reading its output.
 *
 * Provenance: ported from Edge-Sonic's `scripts/lib/wrangler-config/cli.ts`.
 */

import { execFileSync } from 'node:child_process';

/**
 * Runs a wrangler subcommand and returns stdout.
 *
 * Arguments are passed as an argv array rather than interpolated into a shell
 * string, so a value containing shell metacharacters cannot alter the command.
 */
export function runWrangler(args: readonly string[], input?: string): string {
  try {
    // `pnpm` is resolved from PATH deliberately: the scripts run on CI runners and
    // in local shells, and both resolve it the same way.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      ...(input !== undefined && { input }),
    });
  } catch (error: unknown) {
    const maybeProcessError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout: string = maybeProcessError.stdout ? maybeProcessError.stdout.toString() : '';
    const stderr: string = maybeProcessError.stderr ? maybeProcessError.stderr.toString() : '';
    throw new Error(`Command failed: pnpm exec wrangler ${args.join(' ')}\n${stdout}${stderr || maybeProcessError.message || ''}`);
  }
}

/**
 * Parses a JSON array from a command's stdout, naming the command on failure.
 *
 * Several wrangler subcommands print a human-readable table when they detect a
 * TTY, so "not JSON" is an expected outcome that the caller often has a table
 * parser for. Passing the command description turns that into a catchable,
 * self-explanatory error instead of an unlabelled `SyntaxError`.
 */
export function parseJsonArray<T>(output: string, commandDescription: string): T[] {
  try {
    const parsed: unknown = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    // Fall through to the explicit error below.
  }
  throw new Error(`Expected JSON array output from ${commandDescription}. Output:\n${output}`);
}
