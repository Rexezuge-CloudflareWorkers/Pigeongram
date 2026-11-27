/**
 * Checks the live origin the app will load.
 *
 * Unlike a TWA, the WebView shell needs no Digital Asset Links statement and
 * downloads no icons: it renders the deployed origin directly. The origin still
 * has to be up and still has to serve the SPA's manifest, or a build would ship
 * an app that opens a blank or broken page. That check belongs here, before the
 * slow native build, so a stale deployment fails in seconds.
 */

import { isEntrypoint } from '../lib/entrypoint.ts';
import { requiredEnv, runStep } from './actions.ts';

const FETCH_TIMEOUT_MS = 30_000;

export interface DeploymentExpectations {
  /** `https://host`, no trailing path. */
  readonly origin: string;
  readonly fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fetches one URL and requires a direct `200`. */
export async function fetchOk(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${url} could not be fetched (${reason})`);
  }
  if (response.status !== 200) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Reads the PWA manifest's name, proof that the origin serves this SPA. */
export function readManifestName(bytes: Uint8Array): string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The live web manifest is not valid JSON');
  }
  const name = isRecord(manifest) ? manifest.name : undefined;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('The live web manifest has no name');
  }
  return name;
}

/** Fetches the document and manifest the WebView will rely on. */
export async function verifyDeployment(expectations: DeploymentExpectations): Promise<void> {
  const { origin, fetchImpl = fetch } = expectations;
  const [, manifest] = await Promise.all([fetchOk(`${origin}/`, fetchImpl), fetchOk(`${origin}/manifest.webmanifest`, fetchImpl)]);

  console.log(`The live web manifest names "${readManifestName(manifest)}".`);
}

if (isEntrypoint(import.meta.url)) {
  runStep('Android preflight', async () => {
    const origin = requiredEnv('ANDROID_ORIGIN');
    await verifyDeployment({ origin });
    console.log('The live deployment is ready for the app build.');
  });
}
