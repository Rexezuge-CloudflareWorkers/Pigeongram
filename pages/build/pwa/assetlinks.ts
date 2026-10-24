/**
 * The deployment's Digital Asset Links file.
 *
 * A Trusted Web Activity only hides the URL bar when the origin serves a
 * statement that names the Android package and the certificate it is signed
 * with. Both are deployment-specific: a fork picks its own package id and
 * keystore, so the file cannot be committed once and reused.
 *
 * The Pages build therefore reads the two public values (the package id and the
 * certificate fingerprint) from the environment and emits the file into the
 * bundle. Everything here is pure, so the node test project can assert it
 * without a build.
 */

export interface AssetLinksConfig {
  readonly packageId: string;
  readonly fingerprints: readonly string[];
}

export interface AssetLinksStatement {
  readonly relation: readonly string[];
  readonly target: {
    readonly namespace: 'android_app';
    readonly package_name: string;
    readonly sha256_cert_fingerprints: readonly string[];
  };
}

const PREFIX = 'assetlinks:';
const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

// Android's application id rules: at least two dot-separated segments, each
// starting with a letter, then letters, digits or underscores.
const PACKAGE_ID_PATTERN = /^[a-z]\w*(?:\.[a-z]\w*)+$/i;

// A SHA-256 certificate fingerprint: 32 colon-separated pairs of hex digits.
const FINGERPRINT_PATTERN = /^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;

/**
 * Validates an Android application id.
 */
export function validatePackageId(value: string): string {
  const packageId = value.trim();
  if (!PACKAGE_ID_PATTERN.test(packageId)) {
    throw new Error(`${PREFIX} invalid Android package id "${value}"; expected a reverse-DNS id such as com.example.telegramweb`);
  }
  return packageId;
}

/**
 * Validates a SHA-256 certificate fingerprint and returns it in the uppercase
 * form Chrome's verifier expects.
 */
export function normalizeFingerprint(value: string): string {
  const fingerprint = value.trim().toUpperCase();
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error(`${PREFIX} invalid SHA-256 certificate fingerprint "${value}"; expected 32 colon-separated hex pairs`);
  }
  return fingerprint;
}

/**
 * Reads the public Android configuration from the build environment.
 *
 * A deployment without an Android app has neither value set, so the plugin
 * emits nothing and the Pages build is unaffected. Setting one half without the
 * other is a mistake and fails the build rather than serving a statement that
 * can never verify.
 */
export function readAssetLinksConfig(env: NodeJS.ProcessEnv): AssetLinksConfig | null {
  const packageId = env.ANDROID_PACKAGE_ID?.trim() ?? '';
  const releaseFingerprint = env.ANDROID_CERT_SHA256?.trim() ?? '';
  const playFingerprint = env.ANDROID_PLAY_CERT_SHA256?.trim() ?? '';

  if (!packageId && !releaseFingerprint && !playFingerprint) {
    return null;
  }
  if (!packageId) {
    throw new Error(`${PREFIX} ANDROID_PACKAGE_ID is required when a certificate fingerprint is configured`);
  }
  if (!releaseFingerprint) {
    throw new Error(`${PREFIX} ANDROID_CERT_SHA256 is required when ANDROID_PACKAGE_ID is configured`);
  }

  const fingerprints: string[] = [normalizeFingerprint(releaseFingerprint)];
  if (playFingerprint) {
    const normalizedPlayFingerprint = normalizeFingerprint(playFingerprint);
    if (!fingerprints.includes(normalizedPlayFingerprint)) {
      fingerprints.push(normalizedPlayFingerprint);
    }
  }

  return { packageId: validatePackageId(packageId), fingerprints };
}

/**
 * Builds the statement list Chrome's Digital Asset Links verifier reads.
 *
 * The Play certificate is optional: a sideloaded APK is signed with the upload
 * key, while an install from Play is signed with the App Signing certificate,
 * and both have to be present for both install paths to verify.
 */
export function assetLinksStatements(config: AssetLinksConfig): AssetLinksStatement[] {
  if (config.fingerprints.length === 0) {
    throw new Error(`${PREFIX} at least one certificate fingerprint is required`);
  }

  return [
    {
      relation: [HANDLE_ALL_URLS],
      target: {
        namespace: 'android_app',
        package_name: validatePackageId(config.packageId),
        sha256_cert_fingerprints: [...new Set(config.fingerprints.map(normalizeFingerprint))],
      },
    },
  ];
}

/**
 * Serializes the statements as the JSON document served from
 * `/.well-known/assetlinks.json`.
 */
export function buildAssetLinks(config: AssetLinksConfig): string {
  return `${JSON.stringify(assetLinksStatements(config), null, 2)}\n`;
}
