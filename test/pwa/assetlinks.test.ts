import { describe, expect, it } from 'vitest';
import { buildAssetLinks, readAssetLinksConfig } from '../../pages/build/pwa/assetlinks';
import { pwaAssetLinksPlugin } from '../../pages/build/pwa/assetlinks-plugin';

const PACKAGE_ID = 'com.example.telegramweb';

function fingerprint(pair: string): string {
  return Array.from({ length: 32 }, () => pair).join(':');
}

const RELEASE_FINGERPRINT = fingerprint('AA');
const PLAY_FINGERPRINT = fingerprint('BB');

interface EmittedAsset {
  type: 'asset';
  fileName: string;
  source: string;
}

type GenerateBundleHook = (this: { emitFile: (file: EmittedAsset) => void }, options: unknown, bundle: unknown, isWrite: boolean) => void;

function runAssetLinksPlugin(): EmittedAsset[] {
  const emitted: EmittedAsset[] = [];
  const hook = pwaAssetLinksPlugin().generateBundle;
  if (typeof hook !== 'function') {
    throw new Error('pwaAssetLinksPlugin has no generateBundle hook');
  }
  (hook as GenerateBundleHook).call({ emitFile: (file) => emitted.push(file) }, {}, {}, false);
  return emitted;
}

function withAndroidEnv<T>(env: Record<string, string>, run: () => T): T {
  const keys = ['ANDROID_PACKAGE_ID', 'ANDROID_CERT_SHA256', 'ANDROID_PLAY_CERT_SHA256'];
  const previous = keys.map((key) => [key, process.env[key]] as const);

  for (const key of keys) {
    Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, env);

  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * The statement Chrome's Digital Asset Links verifier reads.
 *
 * It is deployment-specific and generated into the Pages build, so a regression
 * here silently brings the URL bar back in every installed Android app.
 */
describe('the Android asset links', () => {
  it('is absent when the deployment has no Android configuration', () => {
    expect(readAssetLinksConfig({})).toBeNull();
    expect(
      readAssetLinksConfig({
        ANDROID_PACKAGE_ID: ' ',
        ANDROID_CERT_SHA256: ' ',
        ANDROID_PLAY_CERT_SHA256: ' ',
      }),
    ).toBeNull();
  });

  it('names the package and its release certificate', () => {
    const json = buildAssetLinks({ packageId: PACKAGE_ID, fingerprints: [RELEASE_FINGERPRINT] });
    const statements: unknown = JSON.parse(json);

    expect(statements).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: PACKAGE_ID,
          sha256_cert_fingerprints: [RELEASE_FINGERPRINT],
        },
      },
    ]);
    expect(json.endsWith('\n')).toBe(true);
  });

  it('adds the Play certificate and removes duplicates', () => {
    const json = buildAssetLinks({
      packageId: PACKAGE_ID,
      fingerprints: [RELEASE_FINGERPRINT.toLowerCase(), RELEASE_FINGERPRINT, PLAY_FINGERPRINT],
    });

    const [statement] = JSON.parse(json) as Array<{
      target: { sha256_cert_fingerprints: string[] };
    }>;
    expect(statement.target.sha256_cert_fingerprints).toEqual([RELEASE_FINGERPRINT, PLAY_FINGERPRINT]);
  });

  it('normalizes the values from the Pages environment', () => {
    expect(
      readAssetLinksConfig({
        ANDROID_PACKAGE_ID: `  ${PACKAGE_ID}  `,
        ANDROID_CERT_SHA256: RELEASE_FINGERPRINT.toLowerCase(),
        ANDROID_PLAY_CERT_SHA256: PLAY_FINGERPRINT.toLowerCase(),
      }),
    ).toEqual({
      packageId: PACKAGE_ID,
      fingerprints: [RELEASE_FINGERPRINT, PLAY_FINGERPRINT],
    });
  });

  it('requires the package id and the release certificate together', () => {
    expect(() => readAssetLinksConfig({ ANDROID_PACKAGE_ID: PACKAGE_ID })).toThrow(/ANDROID_CERT_SHA256/);
    expect(() => readAssetLinksConfig({ ANDROID_CERT_SHA256: RELEASE_FINGERPRINT })).toThrow(/ANDROID_PACKAGE_ID/);
  });

  it('rejects a package id that is not reverse-DNS', () => {
    expect(() =>
      readAssetLinksConfig({
        ANDROID_PACKAGE_ID: 'telegramweb',
        ANDROID_CERT_SHA256: RELEASE_FINGERPRINT,
      }),
    ).toThrow(/package id/);
  });

  it('rejects a certificate fingerprint that is not SHA-256', () => {
    expect(() =>
      readAssetLinksConfig({
        ANDROID_PACKAGE_ID: PACKAGE_ID,
        ANDROID_CERT_SHA256: 'AA:BB',
      }),
    ).toThrow(/fingerprint/);
  });

  it('writes the file at the well-known path during a build', () => {
    const emitted = withAndroidEnv({ ANDROID_PACKAGE_ID: PACKAGE_ID, ANDROID_CERT_SHA256: RELEASE_FINGERPRINT }, runAssetLinksPlugin);

    expect(emitted).toHaveLength(1);
    const [file] = emitted;
    expect(file).toMatchObject({
      type: 'asset',
      fileName: '.well-known/assetlinks.json',
    });
    expect(file.source).toBe(buildAssetLinks({ packageId: PACKAGE_ID, fingerprints: [RELEASE_FINGERPRINT] }));
  });

  it('writes nothing when the deployment has no Android configuration', () => {
    expect(withAndroidEnv({}, runAssetLinksPlugin)).toEqual([]);
  });
});
