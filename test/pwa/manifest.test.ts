import { describe, expect, it } from 'vitest';
import { readBranding } from '../../apps/web/branding';
import { createManifest } from '../../apps/web/build/pwa/manifest';

/**
 * The web app manifest: what the browser needs to install the client.
 */
const MANIFEST = createManifest(readBranding({}));

describe('the web app manifest', () => {
  it('opens the app at its own root', () => {
    expect(MANIFEST.start_url).toBe('/');
    expect(MANIFEST.scope).toBe('/');
    expect(MANIFEST.id).toBe('/');
  });

  it('runs as an app rather than a tab', () => {
    expect(MANIFEST.display).toBe('standalone');
  });

  it('offers the icons the platforms ask for', () => {
    const sizes = MANIFEST.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(MANIFEST.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('paints the chrome in the app palette', () => {
    expect(MANIFEST.theme_color).toBe('#0e1621');
    expect(MANIFEST.background_color).toBe('#0e1621');
  });
});
