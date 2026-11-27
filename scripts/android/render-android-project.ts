/**
 * Renders the native WebView project into `android/build/`.
 *
 * The committed template under `android/template/` holds the Java, Gradle and
 * resource sources with placeholders. This step fills in the deployment's
 * identity, draws its launcher icons from the same paper-plane mark the SPA
 * uses, and writes the signing properties the Gradle build reads. The generated
 * project is gitignored, so a checkout never carries a stale native tree.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodePng } from '../../apps/web/build/pwa/png.ts';
import { renderIcon, TILE_RADIUS_RATIO } from '../../apps/web/build/pwa/mark.ts';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { REPOSITORY_ROOT, requiredEnv, runStep } from './actions.ts';

/** Android's launcher-icon densities and their edge lengths in density-independent pixels. */
export const LAUNCHER_ICONS: readonly { readonly density: string; readonly size: number }[] = [
  { density: 'mdpi', size: 48 },
  { density: 'hdpi', size: 72 },
  { density: 'xhdpi', size: 96 },
  { density: 'xxhdpi', size: 144 },
  { density: 'xxxhdpi', size: 192 },
];

const TEXT_FILE = /\.(?:gradle|properties|xml|java)$/;

export interface AndroidProjectInput {
  readonly origin: string;
  readonly packageId: string;
  readonly appName: string;
  readonly launcherName: string;
  readonly versionName: string;
  readonly versionCode: number;
  readonly keystorePath: string;
  readonly keystorePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
  readonly sdkRoot: string;
}

/** An Android package id becomes the Java source directory. */
export function packagePath(packageId: string): string {
  return packageId.replaceAll('.', '/');
}

/** Escapes a value that lands in an Android XML resource. */
export function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/** Escapes a value that lands in a Java `.properties` file. */
export function propertiesValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll('=', '\\=');
}

/**
 * Replaces every `__KEY__` placeholder and fails on one the caller forgot.
 *
 * A missing value must not ship as a literal placeholder in Gradle or Java:
 * that would fail in the build with a syntax error far from the real cause.
 */
export function substitute(template: string, values: Readonly<Record<string, string>>): string {
  const rendered = template.replace(/__[A-Z_]+__/g, (match) => values[match.slice(2, -2)] ?? match);
  const missing = rendered.match(/__[A-Z_]+__/);
  if (missing) {
    throw new Error(`Unresolved Android template placeholder ${missing[0] ?? ''}`);
  }
  return rendered;
}

function copyTree(source: string, destination: string, values: Readonly<Record<string, string>>): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, substitute(entry.name, values));
    if (entry.isDirectory()) {
      copyTree(from, to, values);
    } else if (entry.isFile()) {
      const bytes = readFileSync(from);
      writeFileSync(to, TEXT_FILE.test(entry.name) ? substitute(bytes.toString('utf8'), values) : bytes);
    }
  }
}

function writeLauncherIcons(outputDirectory: string): void {
  for (const icon of LAUNCHER_ICONS) {
    const directory = path.join(outputDirectory, 'app', 'src', 'main', 'res', `mipmap-${icon.density}`);
    mkdirSync(directory, { recursive: true });
    const pixels = renderIcon(icon.size, { radius: TILE_RADIUS_RATIO, scale: 0.8 });
    writeFileSync(path.join(directory, 'ic_launcher.png'), encodePng(pixels, icon.size, icon.size));
  }
}

/**
 * Copies the template, substitutes its placeholders and writes the two local
 * files the Gradle build needs. Secrets go into `keystore.properties` with mode
 * 0600 and are never printed.
 */
export function renderAndroidProject(templateDirectory: string, outputDirectory: string, input: AndroidProjectInput): void {
  if (!Number.isInteger(input.versionCode) || input.versionCode < 1) {
    throw new Error('versionCode must be a positive integer');
  }

  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  copyTree(templateDirectory, outputDirectory, {
    PACKAGE_ID: input.packageId,
    PACKAGE_PATH: packagePath(input.packageId),
    APP_NAME: escapeXml(input.appName),
    LAUNCHER_NAME: escapeXml(input.launcherName),
    START_URL: escapeXml(`${input.origin}/`),
    VERSION_NAME: input.versionName,
    VERSION_CODE: String(input.versionCode),
  });
  writeLauncherIcons(outputDirectory);

  writeFileSync(
    path.join(outputDirectory, 'keystore.properties'),
    [
      `storeFile=${propertiesValue(input.keystorePath)}`,
      `storePassword=${propertiesValue(input.keystorePassword)}`,
      `keyAlias=${propertiesValue(input.keyAlias)}`,
      `keyPassword=${propertiesValue(input.keyPassword)}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  writeFileSync(path.join(outputDirectory, 'local.properties'), `sdk.dir=${propertiesValue(input.sdkRoot)}\n`);
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android project', () => {
    const versionCode = Number(requiredEnv('VERSION_CODE'));
    if (!Number.isInteger(versionCode)) {
      throw new Error('VERSION_CODE is not an integer');
    }

    renderAndroidProject(path.join(REPOSITORY_ROOT, 'android', 'template'), path.join(REPOSITORY_ROOT, 'android', 'build'), {
      origin: requiredEnv('ANDROID_ORIGIN'),
      packageId: requiredEnv('ANDROID_PACKAGE_ID'),
      appName: requiredEnv('ANDROID_APP_NAME'),
      launcherName: requiredEnv('ANDROID_LAUNCHER_NAME'),
      versionName: requiredEnv('VERSION_NAME'),
      versionCode,
      keystorePath: requiredEnv('ANDROID_KEYSTORE_PATH'),
      keystorePassword: requiredEnv('ANDROID_KEYSTORE_PASSWORD'),
      keyAlias: requiredEnv('ANDROID_KEY_ALIAS'),
      keyPassword: requiredEnv('ANDROID_KEY_PASSWORD'),
      sdkRoot: requiredEnv('ANDROID_SDK_ROOT'),
    });
    console.log('Rendered android/build from android/template.');
  });
}
