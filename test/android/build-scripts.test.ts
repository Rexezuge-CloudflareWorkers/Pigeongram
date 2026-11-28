import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gradleArgs, gradleArtifactPaths } from '../../scripts/android/build-app';
import { renderBuildSummary } from '../../scripts/android/write-summary';
import {
  formatFingerprint,
  normalizeFingerprint,
  parseApksignerFingerprint,
  parseKeytoolFingerprint,
} from '../../scripts/android/fingerprint';
import { readBuildConfig, resolveVersionName } from '../../scripts/android/validate-config';
import { fetchOk, readManifestName, verifyDeployment } from '../../scripts/android/verify-deployment';
import {
  escapeXml,
  LAUNCHER_ICONS,
  packagePath,
  propertiesValue,
  renderAndroidProject,
  substitute,
} from '../../scripts/android/render-android-project';
import { resolveSdkRoot } from '../../scripts/android/setup-sdk';
import { assertLauncherActivityDeclared, dumpManifestArgs, findApksigner } from '../../scripts/android/verify-signatures';

const RELEASE_FINGERPRINT = '16:9F:F8:BE:66:C3:DF:9E:7F:48:B0:4B:5C:10:E0:51:98:BE:ED:1B:71:28:50:49:E9:98:06:B2:FC:AD:FC:BA';
const CANONICAL_RELEASE_FINGERPRINT = RELEASE_FINGERPRINT.replaceAll(':', '');

const TEMPLATE_DIRECTORY = fileURLToPath(new URL('../../android/template', import.meta.url));

function buildEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ANDROID_PWA_ORIGIN: 'https://tg.example.com',
    ANDROID_PACKAGE_ID: 'com.example.telegramweb',
    ANDROID_CERT_SHA256: RELEASE_FINGERPRINT,
    ANDROID_KEYSTORE_BASE64: 'ZmFrZQ==',
    ANDROID_KEYSTORE_PASSWORD: 'storepass',
    ANDROID_KEY_ALIAS: 'telegram',
    ANDROID_KEY_PASSWORD: 'keypass',
    ANDROID_APP_NAME: 'Pigeongram',
    ANDROID_LAUNCHER_NAME: 'Pigeon',
    INPUT_VERSION_NAME: '1.2.3',
    INPUT_VERSION_CODE: '42',
    ...overrides,
  };
}

describe('the Android build configuration', () => {
  it('accepts a complete configuration and normalizes the origin', () => {
    const config = readBuildConfig({ env: buildEnv({ ANDROID_PWA_ORIGIN: 'https://tg.example.com/' }) });

    expect(config).toEqual({
      origin: 'https://tg.example.com',
      host: 'tg.example.com',
      packageId: 'com.example.telegramweb',
      appName: 'Pigeongram',
      launcherName: 'Pigeon',
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
      '\t SHA1: 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
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
  it('reads the PWA manifest name', () => {
    expect(readManifestName(new TextEncoder().encode('{"name":"Pigeongram"}'))).toBe('Pigeongram');
    expect(() => readManifestName(new TextEncoder().encode('not json'))).toThrow('The live web manifest is not valid JSON');
    expect(() => readManifestName(new TextEncoder().encode('{"short_name":"x"}'))).toThrow('The live web manifest has no name');
  });

  it('requires a direct 200', async () => {
    const redirecting = (async () => new Response(null, { status: 302 })) as typeof fetch;
    await expect(fetchOk('https://tg.example.com/', redirecting)).rejects.toThrow('https://tg.example.com/ returned HTTP 302');
  });

  it('fetches the document and manifest in one pass', async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      if (url.endsWith('/manifest.webmanifest')) {
        return new Response('{"name":"Pigeongram"}', { status: 200 });
      }
      return new Response('<!doctype html>', { status: 200 });
    }) as typeof fetch;

    await expect(verifyDeployment({ origin: 'https://tg.example.com', fetchImpl })).resolves.toBeUndefined();
    expect(requests.toSorted()).toEqual(['https://tg.example.com/', 'https://tg.example.com/manifest.webmanifest']);
  });
});

describe('the committed native template', () => {
  it('names the WebView launcher activity in the manifest', () => {
    const manifest = readFileSync(path.join(TEMPLATE_DIRECTORY, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('android:name=".MainActivity"');
    expect(manifest).toContain('android.intent.category.LAUNCHER');
  });

  it('keeps the deployment placeholders in the Java and Gradle sources', () => {
    expect(readFileSync(path.join(TEMPLATE_DIRECTORY, 'app', 'build.gradle'), 'utf8')).toContain("applicationId = '__PACKAGE_ID__'");
    expect(
      readFileSync(path.join(TEMPLATE_DIRECTORY, 'app', 'src', 'main', 'java', '__PACKAGE_PATH__', 'MainActivity.java'), 'utf8'),
    ).toContain('package __PACKAGE_ID__;');
  });

  it('routes the back gesture through the page on Android 16', () => {
    const manifest = readFileSync(path.join(TEMPLATE_DIRECTORY, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('android:enableOnBackInvokedCallback="true"');
    const activity = readFileSync(
      path.join(TEMPLATE_DIRECTORY, 'app', 'src', 'main', 'java', '__PACKAGE_PATH__', 'MainActivity.java'),
      'utf8',
    );
    expect(activity).toContain('registerOnBackInvokedCallback');
    expect(activity).toContain('__pigeongramBack');
  });

  it('denies content URL access in the WebView', () => {
    const activity = readFileSync(
      path.join(TEMPLATE_DIRECTORY, 'app', 'src', 'main', 'java', '__PACKAGE_PATH__', 'MainActivity.java'),
      'utf8',
    );
    expect(activity).toContain('setAllowContentAccess(false)');
    expect(activity).not.toContain('setAllowContentAccess(true)');
    expect(activity).toContain('setAllowFileAccess(false)');
  });

  it('keeps JavaScript enabled only with a documented suppression', () => {
    const activity = readFileSync(
      path.join(TEMPLATE_DIRECTORY, 'app', 'src', 'main', 'java', '__PACKAGE_PATH__', 'MainActivity.java'),
      'utf8',
    );
    const manifest = readFileSync(path.join(TEMPLATE_DIRECTORY, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    expect(activity).toContain('settings.setJavaScriptEnabled(true)');
    expect(activity).toContain('// codeql[java/android/websettings-javascript-enabled]');
    expect(activity).toContain('React SPA');
    expect(activity).not.toContain('webView.addJavascriptInterface(');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
  });
});

describe('the rendered Android project', () => {
  function render(outputDirectory: string): void {
    renderAndroidProject(TEMPLATE_DIRECTORY, outputDirectory, {
      origin: 'https://tg.example.com',
      packageId: 'com.example.telegramweb',
      appName: 'Pigeon & Co',
      launcherName: 'Pigeon',
      versionName: '1.2.3',
      versionCode: 42,
      keystorePath: '/runner/temp/android-release.jks',
      keystorePassword: 'store pass',
      keyAlias: 'telegram',
      keyPassword: 'key=pass',
      sdkRoot: '/sdk',
    });
  }

  it('fills the identity into the Gradle build and the Java package', () => {
    const outputDirectory = mkdtempSync(path.join(os.tmpdir(), 'android-project-'));
    render(outputDirectory);

    const gradle = readFileSync(path.join(outputDirectory, 'app', 'build.gradle'), 'utf8');
    expect(gradle).toContain("applicationId = 'com.example.telegramweb'");
    expect(gradle).toContain('versionCode = 42');
    expect(gradle).toContain("versionName = '1.2.3'");
    expect(existsSync(path.join(outputDirectory, 'app', 'src', 'main', 'java', 'com', 'example', 'telegramweb', 'MainActivity.java'))).toBe(
      true,
    );
  });

  it('escapes resource values and writes the signing properties', () => {
    const outputDirectory = mkdtempSync(path.join(os.tmpdir(), 'android-project-'));
    render(outputDirectory);

    const strings = readFileSync(path.join(outputDirectory, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8');
    expect(strings).toContain('<string name="app_name">Pigeon &amp; Co</string>');
    expect(strings).toContain('<string name="start_url">https://tg.example.com/</string>');

    const signing = readFileSync(path.join(outputDirectory, 'keystore.properties'), 'utf8');
    expect(signing).toContain('storeFile=/runner/temp/android-release.jks');
    expect(signing).toContain(String.raw`keyPassword=key\=pass`);
    expect(readFileSync(path.join(outputDirectory, 'local.properties'), 'utf8')).toBe('sdk.dir=/sdk\n');
  });

  it('draws a launcher icon at every density', () => {
    const outputDirectory = mkdtempSync(path.join(os.tmpdir(), 'android-project-'));
    render(outputDirectory);

    expect(LAUNCHER_ICONS.map((icon) => icon.density)).toEqual(['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']);
    for (const icon of LAUNCHER_ICONS) {
      const file = path.join(outputDirectory, 'app', 'src', 'main', 'res', `mipmap-${icon.density}`, 'ic_launcher.png');
      expect([...readFileSync(file).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it('refuses a placeholder with no value', () => {
    expect(substitute('id=__PACKAGE_ID__', { PACKAGE_ID: 'com.example.app' })).toBe('id=com.example.app');
    expect(() => substitute('id=__PACKAGE_ID__ name=__APP_NAME__', { PACKAGE_ID: 'com.example.app' })).toThrow(
      'Unresolved Android template placeholder __APP_NAME__',
    );
  });

  it('derives the Java package path and escapes XML and properties values', () => {
    expect(packagePath('com.example.app')).toBe('com/example/app');
    expect(escapeXml('A & B <C> "D" \'E\'')).toBe('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;');
    expect(propertiesValue(String.raw`a:b=c\d`)).toBe(String.raw`a\:b\=c\\d`);
  });

  it('refuses a non-positive version code', () => {
    expect(() =>
      renderAndroidProject(TEMPLATE_DIRECTORY, mkdtempSync(path.join(os.tmpdir(), 'android-project-')), {
        origin: 'https://tg.example.com',
        packageId: 'com.example.telegramweb',
        appName: 'Pigeongram',
        launcherName: 'Pigeon',
        versionName: '1.2.3',
        versionCode: 0,
        keystorePath: '/runner/temp/android-release.jks',
        keystorePassword: 'storepass',
        keyAlias: 'telegram',
        keyPassword: 'keypass',
        sdkRoot: '/sdk',
      }),
    ).toThrow('versionCode must be a positive integer');
  });
});

describe('the Gradle build', () => {
  it('runs both tasks without leaving a daemon behind', () => {
    expect(gradleArgs(['assembleRelease', 'bundleRelease'])).toEqual([
      '--no-daemon',
      '--warning-mode=all',
      'assembleRelease',
      'bundleRelease',
    ]);
  });

  it('copies Gradle’s outputs to the published artifact names', () => {
    expect(gradleArtifactPaths('/build').map((artifact) => [artifact.from, artifact.to])).toEqual([
      ['/build/app/build/outputs/apk/release/app-release.apk', '/build/app-release-signed.apk'],
      ['/build/app/build/outputs/bundle/release/app-release.aab', '/build/app-release-bundle.aab'],
    ]);
  });
});

describe('the built APK manifest', () => {
  const activity = 'com.example.telegramweb.MainActivity';

  it('asks aapt2 for the manifest through --file', () => {
    expect(dumpManifestArgs('/build/app-release-signed.apk')).toEqual([
      'dump',
      'xmltree',
      '--file',
      'AndroidManifest.xml',
      '/build/app-release-signed.apk',
    ]);
  });

  it('accepts a manifest declaring the launcher activity', () => {
    const xmlTree = [
      `A: android:name(0x01010003)="${activity}"`,
      'A: android:name(0x01010003)="android.intent.action.MAIN"',
      'A: android:name(0x01010003)="android.intent.category.LAUNCHER"',
    ].join('\n');
    expect(() => assertLauncherActivityDeclared(xmlTree, 'com.example.telegramweb')).not.toThrow();
  });

  it('rejects a manifest that does not declare the activity', () => {
    expect(() => assertLauncherActivityDeclared('E: manifest', 'com.example.telegramweb')).toThrow(/does not declare/);
  });

  it('rejects a manifest whose activity is not the launcher', () => {
    expect(() => assertLauncherActivityDeclared(`A: android:name="${activity}"`, 'com.example.telegramweb')).toThrow(
      /as the launcher activity/,
    );
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
