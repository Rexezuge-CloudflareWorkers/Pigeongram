import type { Plugin } from 'vite';
import { buildAssetLinks, readAssetLinksConfig } from './assetlinks';

/**
 * Writes the deployment's Digital Asset Links file into the bundle.
 *
 * The values are public configuration, supplied to the Pages build as
 * `ANDROID_PACKAGE_ID` and `ANDROID_CERT_SHA256` (plus the optional Play
 * certificate). A deployment without an Android app sets neither, and the
 * plugin emits nothing; a half-configured deployment fails the build in
 * `readAssetLinksConfig` rather than deploying a statement that cannot verify.
 *
 * The file is not part of the service worker's precache glob (which is limited
 * to the app's own code and icons), so Chrome always reads it from the network.
 */
export function pwaAssetLinksPlugin(): Plugin {
  return {
    name: 'pwa-assetlinks',
    apply: 'build',
    generateBundle() {
      const config = readAssetLinksConfig(process.env);
      if (!config) {
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: '.well-known/assetlinks.json',
        source: buildAssetLinks(config),
      });
    },
  };
}
