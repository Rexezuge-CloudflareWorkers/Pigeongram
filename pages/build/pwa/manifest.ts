/**
 * The web app manifest: what the browser needs to install the client as an
 * app rather than a bookmark.
 *
 * One definition, used twice: the plugin writes it into the build, and the
 * dev server serves it, so the dev page and the built page agree.
 */

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: 'any' | 'maskable';
}

export interface PwaManifest {
  name: string;
  short_name: string;
  description: string;
  /**
   * Where the installed app opens: the app's own root, which is public and
   * decides between the intro and the chat list by itself.
   */
  start_url: string;
  scope: string;
  id: string;
  display: 'standalone';
  orientation: 'any';
  theme_color: string;
  background_color: string;
  categories: string[];
  icons: ManifestIcon[];
}

export const MANIFEST: PwaManifest = {
  name: 'Telegram Web Client',
  short_name: 'Telegram Web',
  description: 'A single-account Telegram client that stays online at the edge.',
  start_url: '/',
  scope: '/',
  id: '/',
  display: 'standalone',
  orientation: 'any',
  // The app's own chrome: `base.css`'s `--bg`.
  theme_color: '#0e1621',
  background_color: '#0e1621',
  categories: ['social', 'productivity'],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
