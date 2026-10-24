/**
 * Renders `android/build/twa-manifest.json` from the committed template.
 *
 * The template carries everything that is the same for every deployment
 * (notification delegation, shortcuts, the generator name); this step fills in
 * the deployment's identity and the version of this run. Bubblewrap reads the
 * rendered file in the next step.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isEntrypoint } from '../lib/entrypoint.ts';
import { REPOSITORY_ROOT, requiredEnv, runStep } from './actions.ts';

export interface TwaManifestInput {
  readonly origin: string;
  readonly host: string;
  readonly packageId: string;
  readonly appName: string;
  readonly launcherName: string;
  readonly versionName: string;
  readonly versionCode: number;
  readonly keystorePath: string;
  readonly keyAlias: string;
}

/**
 * Applies the deployment's values to the template.
 *
 * The template is not mutated: the input is the committed file and a caller may
 * want to render more than one variant (the tests do).
 */
export function renderTwaManifest(template: Readonly<Record<string, unknown>>, input: TwaManifestInput): Record<string, unknown> {
  return {
    ...template,
    packageId: input.packageId,
    host: input.host,
    name: input.appName,
    launcherName: input.launcherName,
    appVersion: input.versionName,
    appVersionCode: input.versionCode,
    signingKey: {
      path: input.keystorePath,
      alias: input.keyAlias,
    },
    iconUrl: `${input.origin}/icon-512.png`,
    maskableIconUrl: `${input.origin}/icon-maskable-512.png`,
    webManifestUrl: `${input.origin}/manifest.webmanifest`,
    fullScopeUrl: `${input.origin}/`,
  };
}

/**
 * Serializes a rendered manifest the way Bubblewrap expects to read it.
 */
export function serializeTwaManifest(manifest: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android manifest', () => {
    const templatePath = path.join(REPOSITORY_ROOT, 'android', 'twa-manifest.template.json');
    const outputDirectory = path.join(REPOSITORY_ROOT, 'android', 'build');
    const versionCode = Number(requiredEnv('VERSION_CODE'));
    if (!Number.isInteger(versionCode)) {
      throw new Error('VERSION_CODE is not an integer');
    }

    const template: unknown = JSON.parse(readFileSync(templatePath, 'utf8'));
    if (typeof template !== 'object' || template === null || Array.isArray(template)) {
      throw new Error(`${templatePath} is not a JSON object`);
    }

    const manifest = renderTwaManifest(template as Record<string, unknown>, {
      origin: requiredEnv('ANDROID_ORIGIN'),
      host: requiredEnv('ANDROID_HOST'),
      packageId: requiredEnv('ANDROID_PACKAGE_ID'),
      appName: requiredEnv('ANDROID_APP_NAME'),
      launcherName: requiredEnv('ANDROID_LAUNCHER_NAME'),
      versionName: requiredEnv('VERSION_NAME'),
      versionCode,
      keystorePath: requiredEnv('ANDROID_KEYSTORE_PATH'),
      keyAlias: requiredEnv('ANDROID_KEY_ALIAS'),
    });

    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, 'twa-manifest.json');
    writeFileSync(outputPath, serializeTwaManifest(manifest));
    console.log(`Rendered ${outputPath}.`);
  });
}
