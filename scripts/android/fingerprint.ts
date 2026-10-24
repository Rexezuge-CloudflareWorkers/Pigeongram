/**
 * SHA-256 certificate fingerprints, in the several shapes the tooling prints.
 *
 * `keytool` prints colon-separated groups (`16:9F:…`), `apksigner` prints a bare
 * hex digest, and the repository variable may be either. Comparing the raw
 * strings therefore fails even when the key is correct — the bug that made every
 * signed APK look mismatched. Everything is reduced to one canonical form here.
 */

const SHA256_HEX = /^[0-9A-F]{64}$/;
const SEPARATED_HEX = /^[0-9A-Fa-f:\s]+$/;

/**
 * Canonicalizes a fingerprint: uppercase, bare hex, no separators.
 *
 * @throws when the value is not a SHA-256 digest. A malformed value is rejected
 *   here rather than compared, because a fingerprint that cannot be a digest can
 *   never match one and the mismatch message would hide the real mistake.
 */
export function normalizeFingerprint(value: string): string {
  const trimmed = value.trim();
  if (!SEPARATED_HEX.test(trimmed)) {
    throw new Error(`"${value}" is not a SHA-256 certificate fingerprint`);
  }
  const canonical = trimmed.replace(/[:\s]/g, '').toUpperCase();
  if (!SHA256_HEX.test(canonical)) {
    throw new Error(`"${value}" is not a SHA-256 certificate fingerprint (expected 32 hex pairs)`);
  }
  return canonical;
}

/**
 * Normalizes a value that came from a document we do not control.
 *
 * The assetlinks file is served by the deployment and may hold something that is
 * not a fingerprint at all. This form is for *comparison* only: an unexpected
 * value then shows up in the rejection instead of aborting the whole preflight
 * with a parse error that names no key.
 */
export function looseFingerprint(value: unknown): string {
  return String(value)
    .replace(/[^0-9A-Fa-f]/g, '')
    .toUpperCase();
}

/**
 * Formats a canonical fingerprint the way `keytool -list -v` prints it, which is
 * the form the runbook and the repository variable use.
 */
export function formatFingerprint(value: string): string {
  const canonical = normalizeFingerprint(value);
  return canonical.match(/.{2}/g)?.join(':') ?? canonical;
}

/**
 * Reads `keytool -list -v` / `keytool -printcert` output.
 *
 * The line is indented and may sit beside several other digests (SHA1, MD5), so
 * it is matched by its label rather than by position.
 */
export function parseKeytoolFingerprint(output: string): string | undefined {
  const match = /^\s*SHA256:\s*([0-9A-Fa-f:]+)\s*$/m.exec(output);
  return match?.[1] ? normalizeFingerprint(match[1]) : undefined;
}

/**
 * Reads `apksigner verify --print-certs` output.
 *
 * Build-tools 36+ label the digest per signing scheme
 * (`V3.0 Signer: certificate SHA-256 digest: …`), while older releases print
 * `Signer #1 certificate SHA-256 digest: …`. Matching the suffix accepts both;
 * the value itself is bare hex on modern builds and may be colon-separated on
 * older ones.
 */
export function parseApksignerFingerprint(output: string): string | undefined {
  const match = /^.*certificate SHA-256 digest:\s*([0-9A-Fa-f:]+)\s*$/m.exec(output);
  return match?.[1] ? normalizeFingerprint(match[1]) : undefined;
}
