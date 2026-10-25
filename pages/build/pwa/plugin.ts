import type { Plugin } from 'vite';
import type { Branding } from '../../branding';
import { createManifest } from './manifest';
import { TILE_RADIUS_RATIO, renderIcon } from './mark';
import { encodePng } from './png';

/**
 * The icons the build writes next to the bundle.
 *
 * The three the manifest names are the ones the platforms ask for: a 192 and a
 * 512 for Chromium's install criteria, and a maskable 512 for Android's
 * adaptive icons. The fourth is iOS's touch icon, which iOS reads from the
 * document rather than from the manifest, and which must be opaque — iOS does
 * not composite a transparent icon.
 */
export interface IconSpec {
  readonly file: string;
  readonly size: number;
  /**
   * The corner radius, as a fraction of the edge. Zero squares the tile off:
   * the platform masks the icon itself.
   */
  readonly radius: number;
  /**
   * The mark's size, as a fraction of the edge.
   */
  readonly scale: number;
}

export const ICONS: readonly IconSpec[] = [
  { file: 'icon-192.png', size: 192, radius: TILE_RADIUS_RATIO, scale: 0.8 },
  { file: 'icon-512.png', size: 512, radius: TILE_RADIUS_RATIO, scale: 0.8 },
  // A maskable icon is cropped to the platform's shape, so the mark stays
  // inside the safe zone: a circle of 80% of the icon's edge.
  { file: 'icon-maskable-512.png', size: 512, radius: 0, scale: 0.7 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0, scale: 0.8 },
];

/**
 * Renders one icon into PNG bytes.
 */
export function iconBytes(icon: IconSpec): Uint8Array {
  const pixels = renderIcon(icon.size, { radius: icon.radius, scale: icon.scale });
  return encodePng(pixels, icon.size, icon.size);
}

/**
 * Writes the icons into the bundle and serves them in development.
 *
 * The assets are emitted during `generateBundle`, so they are part of the
 * bundle before workbox globs the output for its precache manifest.
 */
export function pwaIconsPlugin(branding: Branding): Plugin {
  return {
    name: 'pwa-icons',
    generateBundle() {
      for (const icon of ICONS) {
        this.emitFile({ type: 'asset', fileName: icon.file, source: iconBytes(icon) });
      }
    },
    configureServer(server) {
      // The dev server has no build, so it serves the manifest and the icons
      // itself. Without this the document's manifest link is a 404 in dev.
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?', 1)[0] ?? '';
        if (path === '/manifest.webmanifest') {
          response.setHeader('content-type', 'application/manifest+json');
          response.end(JSON.stringify(createManifest(branding)));
          return;
        }
        const icon = ICONS.find((candidate) => candidate.file === path.slice(1));
        if (icon) {
          response.setHeader('content-type', 'image/png');
          response.end(Buffer.from(iconBytes(icon)));
          return;
        }
        next();
      });
    },
  };
}
