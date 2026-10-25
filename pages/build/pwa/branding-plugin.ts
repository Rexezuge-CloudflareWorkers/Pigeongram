import type { Plugin } from 'vite';
import { escapeHtml, type Branding } from '../../branding';

/**
 * Writes the product name into the document title.
 *
 * `index.html` carries `%APP_NAME%` rather than Vite's `%VITE_*%` syntax, so the
 * fallback is the same `branding.ts` default the manifest uses whether or not
 * the build supplied the variable.
 */
export function pwaBrandingPlugin(branding: Branding): Plugin {
  const title = escapeHtml(branding.name);
  return {
    name: 'pwa-branding',
    transformIndexHtml: {
      // Ahead of Vite's own HTML transforms: the placeholder is ours to fill.
      order: 'pre',
      handler(html) {
        // A function replacement keeps `$&`-style sequences in a deployment's
        // name literal rather than letting the regex replacement expand them.
        return html.replaceAll('%APP_NAME%', () => title);
      },
    },
  };
}
