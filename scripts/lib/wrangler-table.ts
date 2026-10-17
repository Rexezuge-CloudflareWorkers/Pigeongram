/**
 * Parsers for the human-readable tables `wrangler` prints.
 *
 * Provenance: ported from Edge-Sonic's `scripts/lib/wrangler-table.ts`, which was
 * factored out of two scripts that had each grown their own copy.
 *
 * `wrangler secrets-store …` renders through `cli-table3`, which draws a
 * box-drawing frame and separates cells with U+2502 (`│`) padded by exactly one
 * space. Columns are therefore *not* space-aligned, and a parser written for
 * aligned output silently matches nothing — which reads as "the resource is
 * absent" and makes provisioning create a duplicate.
 *
 * ### Why membership is exact and never a substring
 *
 * Durable-DAV's `init-secrets.ts` used `output.includes(secretName)`, and that is
 * the defect this port replaces: a store holding both
 * `durable-dav-replication-encryption-key` and a `…-key-backup` would satisfy a
 * substring search for the first, so the real secret was reported as already
 * present and never created. A substring match is not a membership test.
 */

/**
 * Cell separator emitted by `cli-table3`.
 */
const COLUMN_SEPARATOR = String.fromCodePoint(0x25_02);

/**
 * Horizontal rule drawn by `cli-table3`; a row made of these is not data.
 */
const RULE_CHARACTER = String.fromCodePoint(0x25_00);

/**
 * Header row of every `wrangler … list` table.
 */
const HEADER_FIRST_CELL = 'Name';

/**
 * Extracts the data rows of a `wrangler` table, dropping the frame, the header,
 * and any surrounding log lines.
 *
 * Rows are returned in print order with cells trimmed and empty cells removed,
 * so a blank optional column (`Comment`, typically unset) does not shift the
 * columns a caller indexes into.
 */
export function parseWranglerTableRows(output: string): string[][] {
  const rows: string[][] = [];
  for (const line of output.split('\n')) {
    // The frame rows use U+253C (`┼`) at the joints rather than U+2502, so they
    // are already excluded here; the rule-character guard below additionally
    // covers borders that happen to contain a separator.
    if (!line.includes(COLUMN_SEPARATOR)) {
      continue;
    }

    const cells: string[] = line
      .split(COLUMN_SEPARATOR)
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) {
      continue;
    }
    // The header row and the horizontal rules are frame, not data; an empty row is
    // frame too. Destructured rather than indexed so it is total under
    // `noUncheckedIndexedAccess` as well as without it — a consuming repo enables
    // that flag and this package does not, and a script that only typechecks in its
    // author's repository is a script a consumer cannot adopt.
    const [firstCell] = cells;
    if (firstCell === undefined || firstCell === HEADER_FIRST_CELL || firstCell.includes(RULE_CHARACTER)) {
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * The exact names in the first column of a `wrangler secrets-store secret list`
 * table.
 *
 * Exact values rather than a substring search — see the header.
 */
export function parseWranglerNames(output: string): Set<string> {
  const names = new Set<string>();
  for (const row of parseWranglerTableRows(output)) {
    // `.at()` rather than `[0]`: the absence case is real for a hand-built row
    // in a test double, and the guard below is what keeps it out of the set.
    const name = row.at(0);
    if (name !== undefined) names.add(name);
  }
  return names;
}

/**
 * wrangler exits non-zero when a Secrets Store holds no secrets
 * (`secrets-store secret list` throws this `FatalError`), which is
 * indistinguishable by exit code from a genuine failure.
 */
const EMPTY_STORE_MESSAGE = 'List request returned no secrets';

/**
 * True when a failed `secrets-store secret list` means the store is empty
 * rather than the listing having failed.
 *
 * Callers must treat this as a confirmed absence; every other failure has to
 * stay indistinguishable from "unknown", or a transient CLI error would be read
 * as permission to create a secret that already holds a live value.
 */
export function isEmptySecretsStoreListing(error: unknown): boolean {
  const message: string = error instanceof Error ? error.message : String(error);
  return message.includes(EMPTY_STORE_MESSAGE);
}
