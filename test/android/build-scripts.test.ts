import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderBuildSummary } from '../../scripts/android/write-summary';
import {
  formatFingerprint,
  normalizeFingerprint,
  parseApksignerFingerprint,
  parseKeytoolFingerprint,
} from '../../scripts/android/fingerprint';
import { readBuildConfig, resolveVersionName } from '../../scripts/android/validate-config';
import { fetchOk, isPng, readManifestName, validateAssetLinks, verifyDeployment } from '../../scripts/android/verify-deployment';
import { renderTwaManifest, serializeTwaManifest } from '../../scripts/android/render-manifest';
import { resolveSdkRoot } from '../../scripts/android/setup-sdk';
import { findApksigner } from '../../scripts/android/verify-signatures';

const RELEASE_FINGERPRINT = '16:9F:F8:BE:66:C3:DF:9E:7F:48:B0:4B:5C:10:E0:51:98:BE:ED:1B:71:28:50:49:E9:98:06:B2:FC:AD:FC:BA';
const CANONICAL_RELEASE_FINGERPRINT = RELEASE_FINGERPRINT.replaceAll(':', '');
const PLAY_FINGERPRINT = `BB:${'CC:'.repeat(30)}DD`.toUpperCase();
const CANONICAL_PLAY_FINGERPRINT = PLAY_FINGERPRINT.replaceAll(':', '');

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function buildEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ANDROID_PWA_ORIGIN: 'https://tg.example.com',
    ANDROID_PACKAGE_ID: 'com.example.telegramweb',
    ANDROID_CERT_SHA256: RELEASE_FINGERPRINT,
    ANDROID_KEYSTORE_BASE64: 'ZmFrZQ==',
    ANDROID_KEYSTORE_PASSWORD: 'storepass',
    ANDROID_KEY_ALIAS: 'telegram',
    ANDROID_KEY_PASSWORD: 'keypass',
    ANDROID_APP_NAME: 'Telegram Web Client',
    ANDROID_LAUNCHER_NAME: 'Telegram Web',
    INPUT_VERSION_NAME: '1.2.3',
    INPUT_VERSION_CODE: '42',
    ...overrides,
  };
}

function assetLinks(fingerprints: readonly string[], packageId = 'com.example.telegramweb'): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: packageId,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]),
  );
}

describe('the Android build configuration', () => {
  it('accepts a complete configuration and normalizes the origin', () => {
    const config = readBuildConfig({ env: buildEnv({ ANDROID_PWA_ORIGIN: 'https://tg.example.com/' }) });

    expect(config).toEqual({
      origin: 'https://tg.example.com',
      host: 'tg.example.com',
      packageId: 'com.example.telegramweb',
      appName: 'Telegram Web Client',
      launcherName: 'Telegram Web',
      versionName: '1.2.3',
      versionCode: 42,
    });
  });

  it('names every missing variable and secret at once', () => {
    expect(() =>
      readBuildConfig({
        env: buildEnv({ ANDROID_PWA_ORIGIN: '', ANDROID_KEYSTORE_PASSWORD: undefined }),
      }),
    ).toThrow('missing ANDROID_PWA_ORIGIN (repository variable), ANDROID_KEYSTORE_PASSWORD (repository secret)');
  });

  it.each([
    ['https://tg.example.com/path', 'ANDROID_PWA_ORIGIN must be an https origin'],
    ['http://tg.example.com', 'ANDROID_PWA_ORIGIN must be an https origin'],
    ['https://tg.example.com:8443', 'ANDROID_PWA_ORIGIN must be an https origin'],
  ])('rejects the origin %s', (origin, message) => {
    expect(() => readBuildConfig({ env: buildEnv({ ANDROID_PWA_ORIGIN: origin }) })).toThrow(message);
  });

  it('rejects an application id that is not reverse-DNS', () => {
    expect(() => readBuildConfig({ env: buildEnv({ ANDROID_PACKAGE_ID: 'telegram' }) })).toThrow(
      'ANDROID_PACKAGE_ID must be a reverse-DNS application id',
    );
  });

  it('rejects a version code outside Android’s range', () => {
    expect(() => readBuildConfig({ env: buildEnv({ INPUT_VERSION_CODE: '2100000001' }) })).toThrow(
      'version_code must be an integer between 1 and 2100000000',
    );
  });

  it('rejects a version name with a character Android does not accept', () => {
    expect(() => readBuildConfig({ env: buildEnv({ INPUT_VERSION_NAME: 'release 1' }) })).toThrow(
      'version_name must start with a letter or digit',
    );
  });

  it('keeps an explicit version name and falls back to the run number without tags', () => {
    expect(resolveVersionName(buildEnv())).toBe('1.2.3');

    const emptyRepository = mkdtempSync(path.join(os.tmpdir(), 'android-config-'));
    expect(resolveVersionName(buildEnv({ INPUT_VERSION_NAME: '', GITHUB_RUN_NUMBER: '7' }), emptyRepository)).toBe('0.0.0-dev.7');
  });
});

describe('certificate fingerprints', () => {
  it('compares the colon-separated and bare forms as one value', () => {
    expect(normalizeFingerprint(RELEASE_FINGERPRINT)).toBe(CANONICAL_RELEASE_FINGERPRINT);
    expect(normalizeFingerprint(CANONICAL_RELEASE_FINGERPRINT)).toBe(CANONICAL_RELEASE_FINGERPRINT);
    expect(formatFingerprint(CANONICAL_RELEASE_FINGERPRINT)).toBe(RELEASE_FINGERPRINT);
  });

  it('rejects a value that is not a SHA-256 digest', () => {
    expect(() => normalizeFingerprint('AA:BB')).toThrow('is not a SHA-256 certificate fingerprint');
  });

  it('reads the per-scheme apksigner label used by build-tools 36+', () => {
    const output = [
      'Verifies',
      'Verified using v2 scheme (APK Signature Scheme v2): true',
      `V3.0 Signer: certificate SHA-256 digest: ${CANONICAL_RELEASE_FINGERPRINT}`,
      'V3.0 Signer: certificate SHA-1 digest: 0000000000000000000000000000000000000000',
    ].join('\n');

    expect(parseApksignerFingerprint(output)).toBe(CANONICAL_RELEASE_FINGERPRINT);
  });

  it('reads the numbered apksigner label used by older build-tools', () => {
    const output = `Signer #1 certificate SHA-256 digest: ${RELEASE_FINGERPRINT}`;
    expect(parseApksignerFingerprint(output)).toBe(CANONICAL_RELEASE_FINGERPRINT);
  });

  it('reads keytool’s indented SHA256 line', () => {
    const output = [
      'Certificate fingerprints:',
      `\t SHA1: 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00`,
      `\t SHA256: ${RELEASE_FINGERPRINT}`,
      'Signature algorithm name: SHA256withRSA',
    ].join('\n');

    expect(parseKeytoolFingerprint(output)).toBe(CANONICAL_RELEASE_FINGERPRINT);
  });

  it('returns undefined when the output has no matching line', () => {
    expect(parseApksignerFingerprint('Verifies')).toBeUndefined();
    expect(parseKeytoolFingerprint('Certificate fingerprints:')).toBeUndefined();
  });
});

describe('the live deployment preflight', () => {
  const expectations = {
    origin: 'https://tg.example.com',
    packageId: 'com.example.telegramweb',
    fingerprint: CANONICAL_RELEASE_FINGERPRINT,
  } as const;

  it('reads the PWA manifest name', () => {
    expect(readManifestName(new TextEncoder().encode('{"name":"Telegram Web"}'))).toBe('Telegram Web');
    expect(() => readManifestName(new TextEncoder().encode('not json'))).toThrow('The live web manifest is not valid JSON');
    expect(() => readManifestName(new TextEncoder().encode('{"short_name":"x"}'))).toThrow('The live web manifest has no name');
  });

  it('recognizes the PNG signature', () => {
    expect(isPng(PNG_BYTES)).toBe(true);
    expect(isPng(new TextEncoder().encode('<html>'))).toBe(false);
  });

  it('accepts a statement naming the package and the release certificate', () => {
    expect(() => validateAssetLinks(assetLinks([RELEASE_FINGERPRINT]), expectations)).not.toThrow();
  });

  it('accepts the Play certificate when the deployment configures it', () => {
    expect(() =>
      validateAssetLinks(assetLinks([RELEASE_FINGERPRINT, PLAY_FINGERPRINT]), {
        ...expectations,
        playFingerprint: CANONICAL_PLAY_FINGERPRINT,
      }),
    ).not.toThrow();
  });

  it('rejects a statement for another package', () => {
    expect(() => validateAssetLinks(assetLinks([RELEASE_FINGERPRINT], 'com.example.other'), expectations)).toThrow(
      'The live assetlinks.json does not name com.example.telegramweb',
    );
  });

  it('rejects a statement without the URL-handling permission', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify([
        {
          relation: ['delegate_permission/common.get_login_creds'],
          target: {
            namespace: 'android_app',
            package_name: 'com.example.telegramweb',
            sha256_cert_fingerprints: [RELEASE_FINGERPRINT],
          },
        },
      ]),
    );
    expect(() => validateAssetLinks(bytes, expectations)).toThrow('The live assetlinks statement does not handle all URLs');
  });

  it('rejects a statement missing the keystore certificate', () => {
    expect(() => validateAssetLinks(assetLinks([PLAY_FINGERPRINT]), expectations)).toThrow(
      'The live assetlinks.json does not contain the keystore fingerprint',
    );
  });

  it('rejects a statement missing the configured Play certificate', () => {
    expect(() =>
      validateAssetLinks(assetLinks([RELEASE_FINGERPRINT]), {
        ...expectations,
        playFingerprint: CANONICAL_PLAY_FINGERPRINT,
      }),
    ).toThrow('does not contain every configured certificate fingerprint');
  });

  it('rejects a statement naming a certificate the deployment does not configure', () => {
    expect(() => validateAssetLinks(assetLinks([RELEASE_FINGERPRINT, PLAY_FINGERPRINT]), expectations)).toThrow(
      'names unexpected certificate fingerprints',
    );
  });

  it('requires a direct 200', async () => {
    const redirecting = (async () => new Response(null, { status: 302 })) as typeof fetch;
    await expect(fetchOk('https://tg.example.com/', redirecting)).rejects.toThrow('https://tg.example.com/ returned HTTP 302');
  });

  it('fetches and validates every resource in one pass', async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      if (url.endsWith('/.well-known/assetlinks.json')) {
        return new Response(assetLinks([RELEASE_FINGERPRINT]), { status: 200 });
      }
      if (url.endsWith('/manifest.webmanifest')) {
        return new Response('{"name":"Telegram Web"}', { status: 200 });
      }
      if (url.endsWith('.png')) {
        return new Response(PNG_BYTES.buffer as ArrayBuffer, { status: 200 });
      }
      return new Response('<!doctype html>', { status: 200 });
    }) as typeof fetch;

    await expect(verifyDeployment({ ...expectations, fetchImpl })).resolves.toBeUndefined();
    expect(requests.toSorted()).toEqual([
      'https://tg.example.com/',
      'https://tg.example.com/.well-known/assetlinks.json',
      'https://tg.example.com/icon-512.png',
      'https://tg.example.com/icon-maskable-512.png',
      'https://tg.example.com/manifest.webmanifest',
    ]);
  });
});

describe('the rendered TWA manifest', () => {
  const template = {
    packageId: 'com.example.placeholder',
    name: 'Placeholder',
    enableNotifications: false,
    shortcuts: [],
  };
  const input = {
    origin: 'https://tg.example.com',
    host: 'tg.example.com',
    packageId: 'com.example.telegramweb',
    appName: 'Telegram Web Client',
    launcherName: 'Telegram Web',
    versionName: '1.2.3',
    versionCode: 42,
    keystorePath: '/runner/temp/android-release.jks',
    keyAlias: 'telegram',
  };

  it('fills the deployment identity and keeps the template’s shared fields', () => {
    const manifest = renderTwaManifest(template, input);

    expect(manifest).toMatchObject({
      packageId: input.packageId,
      host: input.host,
      name: input.appName,
      launcherName: input.launcherName,
      appVersion: input.versionName,
      appVersionCode: input.versionCode,
      signingKey: { path: input.keystorePath, alias: 'telegram' },
      iconUrl: 'https://tg.example.com/icon-512.png',
      maskableIconUrl: 'https://tg.example.com/icon-maskable-512.png',
      webManifestUrl: 'https://tg.example.com/manifest.webmanifest',
      fullScopeUrl: 'https://tg.example.com/',
      enableNotifications: false,
      shortcuts: [],
    });
    expect(template.packageId).toBe('com.example.placeholder');
  });

  it('serializes with a trailing newline', () => {
    expect(serializeTwaManifest({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe('the build summary', () => {
  it('records the identity baked into the APK', () => {
    const summary = renderBuildSummary({
      origin: 'https://tg.example.com',
      packageId: 'com.example.telegramweb',
      appName: 'Telegram | Web',
      versionName: '1.2.3',
      versionCode: '42',
      fingerprint: RELEASE_FINGERPRINT,
    });

    expect(summary).toContain('| Origin | `https://tg.example.com` |');
    expect(summary).toContain(String.raw`| App name | Telegram \| Web |`);
    expect(summary).toContain('| Certificate SHA-256 |');
    expect(summary).toMatch(/\n$/);
  });
});

describe('the Android SDK helpers', () => {
  it('prefers ANDROID_SDK_ROOT, then ANDROID_HOME, then the runner default', () => {
    expect(resolveSdkRoot({ ANDROID_SDK_ROOT: '/a', ANDROID_HOME: '/b' })).toBe('/a');
    expect(resolveSdkRoot({ ANDROID_HOME: '/b' })).toBe('/b');
    expect(resolveSdkRoot({})).toBe('/usr/local/lib/android/sdk');
  });

  it('picks the newest installed build-tools release numerically', () => {
    const sdkRoot = mkdtempSync(path.join(os.tmpdir(), 'android-sdk-'));
    for (const version of ['36.0.0', '36.10.0', '36.9.0']) {
      mkdirSync(path.join(sdkRoot, 'build-tools', version), { recursive: true });
      writeFileSync(path.join(sdkRoot, 'build-tools', version, 'apksigner'), '');
    }

    expect(findApksigner(sdkRoot)).toBe(path.join(sdkRoot, 'build-tools', '36.10.0', 'apksigner'));
  });

  it('fails clearly when no build-tools directory exists', () => {
    const sdkRoot = mkdtempSync(path.join(os.tmpdir(), 'android-sdk-'));
    expect(() => findApksigner(sdkRoot)).toThrow(`No build-tools directory under ${sdkRoot}`);
  });
});
